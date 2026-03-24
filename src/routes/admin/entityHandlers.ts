import { getDb } from "@/db";
import {
  documents,
  entities,
  highlights,
  highlightsEntitiesRel,
} from "@/db/external_schema";
import { userFile } from "@/db/schema";
import {
  AdminEntityDetailResponseSchema,
  AdminEntityListResponseSchema,
} from "@/schemas/admin.schema";
import { NotFoundError } from "@/utils/errorHandler";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { MAX_PAGE_SIZE, clampPageSize, isUuidLike, toIsoOrNull } from "./utils";

export const registerEntityHandlers = async (fastify: FastifyInstance) => {
  fastify.get<{
    Querystring: {
      orgId: string;
      q?: string;
      page?: number;
      pageSize?: number;
    };
  }>("/entities", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "List external entities by org",
      tags: ["Admin"],
      querystring: Type.Object({
        orgId: Type.String(),
        q: Type.Optional(Type.String()),
        page: Type.Optional(Type.Number({ minimum: 1 })),
        pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_PAGE_SIZE })),
      }),
      response: {
        200: AdminEntityListResponseSchema,
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "list_entities",
        ip: request.ip,
      });

      const { orgId, q, page = 1 } = request.query;
      if (!isUuidLike(orgId)) {
        return reply.send({
          items: [],
          total: 0,
        });
      }

      const pageSize = clampPageSize(request.query.pageSize);
      const offset = (page - 1) * pageSize;
      const searchPattern = (q?.trim() ?? "") !== "" ? `%${q?.trim()}%` : null;

      const whereClause = and(
        eq(highlights.teamId, orgId),
        searchPattern
          ? or(
              ilike(entities.name, searchPattern),
              ilike(entities.uniqueId, searchPattern),
              ilike(entities.description, searchPattern),
            )
          : undefined,
      );

      const [totalRow] = await getDb()
        .select({
          count: sql<number>`CAST(COUNT(DISTINCT ${entities.id}) AS INTEGER)`,
        })
        .from(entities)
        .innerJoin(highlightsEntitiesRel, eq(highlightsEntitiesRel.entityId, entities.id))
        .innerJoin(highlights, eq(highlights.id, highlightsEntitiesRel.highlightId))
        .where(whereClause);

      const rows = await getDb()
        .select({
          id: entities.id,
          name: entities.name,
          type: entities.type,
          description: entities.description,
          highlightCount: sql<number>`CAST(COUNT(DISTINCT ${highlights.id}) AS INTEGER)`,
          documentCount: sql<number>`CAST(COUNT(DISTINCT ${highlights.documentId}) AS INTEGER)`,
          lastMentionedAt: sql<Date | null>`MAX(${highlights.createdAt})`,
        })
        .from(entities)
        .innerJoin(highlightsEntitiesRel, eq(highlightsEntitiesRel.entityId, entities.id))
        .innerJoin(highlights, eq(highlights.id, highlightsEntitiesRel.highlightId))
        .where(whereClause)
        .groupBy(entities.id, entities.name, entities.type, entities.description)
        .orderBy(asc(entities.name))
        .limit(pageSize)
        .offset(offset);

      return reply.send({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type ?? null,
          description: row.description ?? null,
          highlightCount: row.highlightCount ?? 0,
          documentCount: row.documentCount ?? 0,
          lastMentionedAt: toIsoOrNull(row.lastMentionedAt),
        })),
        total: totalRow?.count ?? 0,
      });
    },
  });

  fastify.get<{
    Params: { entityId: number };
    Querystring: {
      orgId: string;
      highlightsPage?: number;
      highlightsPageSize?: number;
    };
  }>("/entities/:entityId", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Get entity details with related highlights and documents",
      tags: ["Admin"],
      params: Type.Object({
        entityId: Type.Number(),
      }),
      querystring: Type.Object({
        orgId: Type.String(),
        highlightsPage: Type.Optional(Type.Number({ minimum: 1 })),
        highlightsPageSize: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_PAGE_SIZE })),
      }),
      response: {
        200: AdminEntityDetailResponseSchema,
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "view_entity",
        resourceId: request.params.entityId,
        ip: request.ip,
      });

      const { entityId } = request.params;
      const { orgId } = request.query;
      const highlightsPage = request.query.highlightsPage ?? 1;
      const highlightsPageSize = clampPageSize(request.query.highlightsPageSize);
      const highlightsOffset = (highlightsPage - 1) * highlightsPageSize;

      const entity = await getDb().query.entities.findFirst({
        where: eq(entities.id, entityId),
      });
      if (!entity) {
        throw new NotFoundError("Entity not found");
      }

      if (!isUuidLike(orgId)) {
        return reply.send({
          entity: {
            id: entity.id,
            name: entity.name,
            uniqueId: entity.uniqueId ?? null,
            type: entity.type ?? null,
            description: entity.description ?? null,
            createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
            updatedAt: toIsoOrNull(entity.updatedAt),
          },
          highlights: {
            items: [],
            total: 0,
          },
          relatedDocuments: [],
        });
      }

      const highlightWhere = and(
        eq(highlightsEntitiesRel.entityId, entityId),
        eq(highlights.teamId, orgId),
      );

      const [highlightTotal, highlightRows, relatedDocumentRows] = await Promise.all([
        getDb()
          .select({
            count: sql<number>`CAST(COUNT(DISTINCT ${highlights.id}) AS INTEGER)`,
          })
          .from(highlightsEntitiesRel)
          .innerJoin(highlights, eq(highlights.id, highlightsEntitiesRel.highlightId))
          .where(highlightWhere),
        getDb()
          .select({
            id: highlights.id,
            documentId: highlights.documentId,
            content: highlights.content,
            type: highlights.type,
            aiSummary: highlights.aiSummary,
            createdAt: highlights.createdAt,
          })
          .from(highlightsEntitiesRel)
          .innerJoin(highlights, eq(highlights.id, highlightsEntitiesRel.highlightId))
          .where(highlightWhere)
          .orderBy(desc(highlights.createdAt))
          .limit(highlightsPageSize)
          .offset(highlightsOffset),
        getDb()
          .select({
            id: documents.id,
            title: documents.title,
            type: documents.type,
            documentUrl: documents.documentUrl,
            linkedUserFileId: userFile.id,
          })
          .from(highlightsEntitiesRel)
          .innerJoin(highlights, eq(highlights.id, highlightsEntitiesRel.highlightId))
          .innerJoin(documents, eq(documents.id, highlights.documentId))
          .leftJoin(
            userFile,
            and(eq(userFile.sourceDocumentId, documents.id), eq(userFile.orgId, orgId)),
          )
          .where(
            and(
              highlightWhere,
              isNotNull(highlights.documentId),
              isNotNull(documents.id),
              eq(documents.teamId, orgId),
            ),
          )
          .orderBy(desc(highlights.createdAt)),
      ]);

      const relatedDocumentsMap = new Map<
        number,
        {
          id: number;
          title: string | null;
          type: "pdf" | "webpage" | null;
          documentUrl: string | null;
          linkedUserFileId: string | null;
        }
      >();
      for (const row of relatedDocumentRows) {
        if (!row.id) continue;
        const existing = relatedDocumentsMap.get(row.id);
        if (!existing) {
          relatedDocumentsMap.set(row.id, {
            id: row.id,
            title: row.title ?? null,
            type: row.type ?? null,
            documentUrl: row.documentUrl ?? null,
            linkedUserFileId: row.linkedUserFileId ?? null,
          });
          continue;
        }
        if (!existing.linkedUserFileId && row.linkedUserFileId) {
          existing.linkedUserFileId = row.linkedUserFileId;
        }
      }

      return reply.send({
        entity: {
          id: entity.id,
          name: entity.name,
          uniqueId: entity.uniqueId ?? null,
          type: entity.type ?? null,
          description: entity.description ?? null,
          createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
          updatedAt: toIsoOrNull(entity.updatedAt),
        },
        highlights: {
          items: highlightRows.map((row) => ({
            id: row.id,
            documentId: row.documentId ?? null,
            content: row.content ?? null,
            type: row.type ?? null,
            aiSummary: row.aiSummary ?? null,
            createdAt: toIsoOrNull(row.createdAt) ?? new Date().toISOString(),
          })),
          total: highlightTotal[0]?.count ?? 0,
        },
        relatedDocuments: Array.from(relatedDocumentsMap.values()),
      });
    },
  });
};
