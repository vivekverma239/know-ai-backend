import { getDb } from "@/db";
import {
  accounts,
  documents,
  entities,
  highlights,
  highlightsEntitiesRel,
  organizations,
} from "@/db/external_schema";
import {
  type UserFileStatus,
  chunks,
  userFile,
  userFileChapter,
  userFilePage,
  userFileSection,
  userFileToCMeta,
} from "@/db/schema";
import {
  AdminDocumentChaptersResponseSchema,
  AdminDocumentDetailResponseSchema,
  AdminDocumentListResponseSchema,
  AdminDocumentPageSchema,
  AdminDocumentPagesResponseSchema,
  AdminDocumentSectionsResponseSchema,
  AdminDocumentTocMetadataResponseSchema,
  AdminEntityDetailResponseSchema,
  AdminEntityListResponseSchema,
  AdminOrgListResponseSchema,
} from "@/schemas/admin.schema";
import { getPdfStoragePathCandidates, resolveExistingPdfStoragePath } from "@/service/file/storagePath";
import { getStorage } from "@/service/googleStorage";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import {
  type SQLWrapper,
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const toIsoOrNull = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const clampPageSize = (pageSize: number | undefined) => {
  if (!pageSize || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(pageSize, MAX_PAGE_SIZE);
};

const isUuidLike = (value: string) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
};

const getSignedPdfUrl = async (file: typeof userFile.$inferSelect): Promise<string | null> => {
  if (file.type !== "pdf") {
    return null;
  }

  const storage = getStorage();

  try {
    const existingPath = await resolveExistingPdfStoragePath(storage, {
      id: file.id,
      userId: file.userId,
      orgId: file.orgId,
      isAdminFile: file.isAdminFile,
    });

    if (existingPath) {
      return await storage.getSignedUrl(existingPath);
    }

    if (file.sourceDocumentUrl && /^https?:\/\//i.test(file.sourceDocumentUrl)) {
      return file.sourceDocumentUrl;
    }

    logger.warn("No stored PDF found for admin document preview", {
      fileId: file.id,
      candidatePaths: getPdfStoragePathCandidates({
        id: file.id,
        userId: file.userId,
        orgId: file.orgId,
        isAdminFile: file.isAdminFile,
      }),
      hasSourceDocumentUrl: Boolean(file.sourceDocumentUrl),
    });
    return null;
  } catch (error) {
    logger.warn("Failed to generate admin document signed URL", {
      fileId: file.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const adminRoutes = async (fastify: FastifyInstance) => {
  fastify.get("/orgs", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "List organizations with document counts",
      tags: ["Admin"],
      response: {
        200: AdminOrgListResponseSchema,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (_request, reply) => {
      const orgRows = await getDb()
        .select({
          orgId: userFile.orgId,
          documentCount: sql<number>`CAST(COUNT(*) AS INTEGER)`,
        })
        .from(userFile)
        .groupBy(userFile.orgId)
        .orderBy(desc(sql`COUNT(*)`));

      const orgIds = orgRows.map((row) => row.orgId);
      const uuidOrgIds = orgIds.filter((orgId) => isUuidLike(orgId));

      // userFile.orgId is actually a teamId from the external system.
      // Look up names from both organizations and accounts (which stores team accounts).
      const [orgNames, accountNames] = uuidOrgIds.length
        ? await Promise.all([
            getDb()
              .select({ id: organizations.id, name: organizations.name })
              .from(organizations)
              .where(inArray(organizations.id, uuidOrgIds)),
            getDb()
              .select({ id: accounts.id, name: accounts.name })
              .from(accounts)
              .where(inArray(accounts.id, uuidOrgIds)),
          ])
        : [[], []];

      const orgNameMap = new Map<string, string>();
      for (const org of orgNames) {
        if (org.name) orgNameMap.set(org.id, org.name);
      }
      // Account names (team accounts) take priority if both exist
      for (const acc of accountNames) {
        if (acc.name) orgNameMap.set(acc.id, acc.name);
      }

      return reply.send({
        items: orgRows.map((row) => ({
          orgId: row.orgId,
          name: orgNameMap.get(row.orgId) ?? null,
          documentCount: row.documentCount ?? 0,
        })),
      });
    },
  });

  fastify.get<{
    Querystring: {
      orgId?: string;
      search?: string;
      status?: UserFileStatus | "all";
      type?: "pdf" | "structured_report" | "web_article" | "all";
      page?: number;
      pageSize?: number;
    };
  }>("/documents", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "List documents across orgs with metadata and counts",
      tags: ["Admin"],
      querystring: Type.Object({
        orgId: Type.Optional(Type.String()),
        search: Type.Optional(Type.String()),
        status: Type.Optional(
          Type.Union([
            Type.Literal("all"),
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
            Type.Literal("failed"),
          ]),
        ),
        type: Type.Optional(
          Type.Union([
            Type.Literal("all"),
            Type.Literal("pdf"),
            Type.Literal("structured_report"),
            Type.Literal("web_article"),
          ]),
        ),
        page: Type.Optional(Type.Number({ minimum: 1 })),
        pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_PAGE_SIZE })),
      }),
      response: {
        200: AdminDocumentListResponseSchema,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const { orgId, search, status, type, page = 1 } = request.query;
      const pageSize = clampPageSize(request.query.pageSize);
      const offset = (page - 1) * pageSize;

      const whereConditions: SQLWrapper[] = [];
      if (orgId) whereConditions.push(eq(userFile.orgId, orgId));
      if (status && status !== "all") whereConditions.push(eq(userFile.status, status));
      if (type && type !== "all") whereConditions.push(eq(userFile.type, type));
      if ((search?.trim() ?? "") !== "") {
        const pattern = `%${search?.trim()}%`;
        whereConditions.push(
          or(
            ilike(userFile.name, pattern),
            ilike(userFile.sourceDocumentUrl, pattern),
          ) as SQLWrapper,
        );
      }

      const whereClause = whereConditions.length ? and(...whereConditions) : undefined;
      const [totalRow] = await getDb()
        .select({
          count: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("count"),
        })
        .from(userFile)
        .where(whereClause);

      const userFiles = getDb()
        .select()
        .from(userFile)
        .where(whereClause)
        .orderBy(desc(userFile.createdAt))
        .limit(pageSize)
        .offset(offset)
        .as("userFiles");

      const pageCount = getDb()
        .select({
          documentId: userFilePage.fileId,
          pageCount: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("pageCount"),
        })
        .from(userFilePage)
        .groupBy(userFilePage.fileId)
        .as("pageCount");

      const chunkCount = getDb()
        .select({
          documentId: chunks.documentId,
          chunkCount: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("chunkCount"),
        })
        .from(chunks)
        .groupBy(chunks.documentId)
        .as("chunkCount");

      const chapterCount = getDb()
        .select({
          documentId: userFileChapter.fileId,
          chapterCount: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("chapterCount"),
        })
        .from(userFileChapter)
        .groupBy(userFileChapter.fileId)
        .as("chapterCount");

      const sectionCount = getDb()
        .select({
          documentId: userFileSection.fileId,
          sectionCount: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("sectionCount"),
        })
        .from(userFileSection)
        .groupBy(userFileSection.fileId)
        .as("sectionCount");

      const rows = await getDb()
        .select({
          id: userFiles.id,
          name: userFiles.name,
          status: userFiles.status,
          type: userFiles.type,
          isAdminFile: userFiles.isAdminFile,
          userId: userFiles.userId,
          orgId: userFiles.orgId,
          metadata: userFiles.metadata,
          sourceDocumentId: userFiles.sourceDocumentId,
          sourceDocumentUrl: userFiles.sourceDocumentUrl,
          createdAt: userFiles.createdAt,
          updatedAt: userFiles.updatedAt,
          numPages: pageCount.pageCount,
          numChunks: chunkCount.chunkCount,
          numChapters: chapterCount.chapterCount,
          numSections: sectionCount.sectionCount,
        })
        .from(userFiles)
        .leftJoin(pageCount, eq(userFiles.id, pageCount.documentId))
        .leftJoin(chunkCount, eq(userFiles.id, chunkCount.documentId))
        .leftJoin(chapterCount, eq(userFiles.id, chapterCount.documentId))
        .leftJoin(sectionCount, eq(userFiles.id, sectionCount.documentId))
        .orderBy(desc(userFiles.createdAt));

      return reply.send({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          type: row.type,
          isAdminFile: row.isAdminFile ?? false,
          userId: row.userId,
          orgId: row.orgId,
          metadata: row.metadata ?? null,
          sourceDocumentId: row.sourceDocumentId ?? null,
          sourceDocumentUrl: row.sourceDocumentUrl ?? null,
          createdAt: toIsoOrNull(row.createdAt) ?? new Date().toISOString(),
          updatedAt: toIsoOrNull(row.updatedAt),
          numPages: row.numPages ?? 0,
          numChunks: row.numChunks ?? 0,
          numChapters: row.numChapters ?? 0,
          numSections: row.numSections ?? 0,
        })),
        total: totalRow?.count ?? 0,
      });
    },
  });

  fastify.get<{
    Params: { id: string };
  }>("/documents/:id", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Get admin document details with signed URL and counts",
      tags: ["Admin"],
      params: Type.Object({ id: Type.String() }),
      response: {
        200: AdminDocumentDetailResponseSchema,
        401: Type.Object({ error: Type.String() }),
        404: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const file = await getDb().query.userFile.findFirst({
        where: eq(userFile.id, request.params.id),
      });
      if (!file) {
        return reply.code(404).send({ error: "Document not found" });
      }

      const [pagesCount, chunksCount, chaptersCount, sectionsCount, signedUrl] = await Promise.all([
        getDb()
          .select({ count: sql<number>`CAST(COUNT(*) AS INTEGER)` })
          .from(userFilePage)
          .where(eq(userFilePage.fileId, file.id)),
        getDb()
          .select({ count: sql<number>`CAST(COUNT(*) AS INTEGER)` })
          .from(chunks)
          .where(eq(chunks.documentId, file.id)),
        getDb()
          .select({ count: sql<number>`CAST(COUNT(*) AS INTEGER)` })
          .from(userFileChapter)
          .where(eq(userFileChapter.fileId, file.id)),
        getDb()
          .select({ count: sql<number>`CAST(COUNT(*) AS INTEGER)` })
          .from(userFileSection)
          .where(eq(userFileSection.fileId, file.id)),
        getSignedPdfUrl(file),
      ]);

      return reply.send({
        id: file.id,
        name: file.name,
        status: file.status,
        type: file.type,
        isAdminFile: file.isAdminFile ?? false,
        userId: file.userId,
        orgId: file.orgId,
        metadata: file.metadata ?? null,
        sourceDocumentId: file.sourceDocumentId ?? null,
        sourceDocumentUrl: file.sourceDocumentUrl ?? null,
        createdAt: toIsoOrNull(file.createdAt) ?? new Date().toISOString(),
        updatedAt: toIsoOrNull(file.updatedAt),
        numPages: pagesCount[0]?.count ?? 0,
        numChunks: chunksCount[0]?.count ?? 0,
        numChapters: chaptersCount[0]?.count ?? 0,
        numSections: sectionsCount[0]?.count ?? 0,
        signedUrl,
        webArticleMetadata: file.webArticleMetadata ?? null,
      });
    },
  });

  fastify.get<{
    Params: { id: string };
    Querystring: { page?: number; pageSize?: number };
  }>("/documents/:id/pages", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Get parsed pages for a document",
      tags: ["Admin"],
      params: Type.Object({ id: Type.String() }),
      querystring: Type.Object({
        page: Type.Optional(Type.Number({ minimum: 1 })),
        pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_PAGE_SIZE })),
      }),
      response: {
        200: AdminDocumentPagesResponseSchema,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const page = request.query.page ?? 1;
      const pageSize = clampPageSize(request.query.pageSize);
      const offset = (page - 1) * pageSize;
      const fileId = request.params.id;

      const [items, totalRows] = await Promise.all([
        getDb().query.userFilePage.findMany({
          where: eq(userFilePage.fileId, fileId),
          orderBy: (table, { asc: ascOrder }) => [ascOrder(table.pageNumber)],
          limit: pageSize,
          offset,
        }),
        getDb()
          .select({ count: sql<number>`CAST(COUNT(*) AS INTEGER)` })
          .from(userFilePage)
          .where(eq(userFilePage.fileId, fileId)),
      ]);

      return reply.send({
        items: items.map((item) => ({
          id: item.id,
          fileId: item.fileId,
          pageNumber: item.pageNumber,
          content: item.content,
        })),
        total: totalRows[0]?.count ?? 0,
      });
    },
  });

  fastify.get<{
    Params: { id: string; pageNumber: number };
  }>("/documents/:id/page/:pageNumber", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Get one parsed page by page number",
      tags: ["Admin"],
      params: Type.Object({
        id: Type.String(),
        pageNumber: Type.Number({ minimum: 1 }),
      }),
      response: {
        200: AdminDocumentPageSchema,
        401: Type.Object({ error: Type.String() }),
        404: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const page = await getDb().query.userFilePage.findFirst({
        where: and(
          eq(userFilePage.fileId, request.params.id),
          eq(userFilePage.pageNumber, request.params.pageNumber),
        ),
      });
      if (!page) {
        return reply.code(404).send({ error: "Page not found" });
      }
      return reply.send({
        id: page.id,
        fileId: page.fileId,
        pageNumber: page.pageNumber,
        content: page.content,
      });
    },
  });

  fastify.get<{
    Params: { id: string };
    Querystring: { page?: number; pageSize?: number };
  }>("/documents/:id/sections", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Get parsed sections for a document",
      tags: ["Admin"],
      params: Type.Object({ id: Type.String() }),
      querystring: Type.Object({
        page: Type.Optional(Type.Number({ minimum: 1 })),
        pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_PAGE_SIZE })),
      }),
      response: {
        200: AdminDocumentSectionsResponseSchema,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const page = request.query.page ?? 1;
      const pageSize = clampPageSize(request.query.pageSize);
      const offset = (page - 1) * pageSize;
      const fileId = request.params.id;

      const [items, totalRows] = await Promise.all([
        getDb().query.userFileSection.findMany({
          where: eq(userFileSection.fileId, fileId),
          orderBy: (table, { asc: ascOrder }) => [ascOrder(table.startPage)],
          limit: pageSize,
          offset,
        }),
        getDb()
          .select({ count: sql<number>`CAST(COUNT(*) AS INTEGER)` })
          .from(userFileSection)
          .where(eq(userFileSection.fileId, fileId)),
      ]);

      return reply.send({
        items: items.map((item) => ({
          id: item.id,
          fileId: item.fileId,
          chapterId: item.chapterId ?? null,
          startPage: item.startPage,
          endPage: item.endPage,
          title: item.title,
          summary: item.summary,
          metadata: item.metadata as Record<string, unknown> | null,
          createdAt: toIsoOrNull(item.createdAt) ?? new Date().toISOString(),
          updatedAt: toIsoOrNull(item.updatedAt),
        })),
        total: totalRows[0]?.count ?? 0,
      });
    },
  });

  fastify.get<{
    Params: { id: string };
  }>("/documents/:id/chapters", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Get chapters for a document",
      tags: ["Admin"],
      params: Type.Object({ id: Type.String() }),
      response: {
        200: AdminDocumentChaptersResponseSchema,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const fileId = request.params.id;
      const items = await getDb().query.userFileChapter.findMany({
        where: eq(userFileChapter.fileId, fileId),
        orderBy: (table, { asc: ascOrder }) => [ascOrder(table.startPage)],
      });

      return reply.send({
        items: items.map((item) => ({
          id: item.id,
          fileId: item.fileId,
          title: item.title,
          summary: item.summary,
          startPage: item.startPage,
          endPage: item.endPage,
          createdAt: toIsoOrNull(item.createdAt) ?? new Date().toISOString(),
        })),
        total: items.length,
      });
    },
  });

  fastify.get<{
    Params: { id: string };
  }>("/documents/:id/toc-meta", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Get ToC and extracted metadata for a document",
      tags: ["Admin"],
      params: Type.Object({ id: Type.String() }),
      response: {
        200: AdminDocumentTocMetadataResponseSchema,
        401: Type.Object({ error: Type.String() }),
        404: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const fileId = request.params.id;

      const [file, tocMeta] = await Promise.all([
        getDb().query.userFile.findFirst({
          where: eq(userFile.id, fileId),
        }),
        getDb().query.userFileToCMeta.findFirst({
          where: eq(userFileToCMeta.fileId, fileId),
        }),
      ]);

      if (!file) {
        return reply.code(404).send({
          error: "Document not found",
        });
      }

      return reply.send({
        toc: (tocMeta?.toc as Record<string, unknown> | null) ?? null,
        extractedMetadata: (tocMeta?.metadata as Record<string, unknown> | null) ?? null,
        fileMetadata: (file.metadata as Record<string, unknown> | null) ?? null,
        pages: (tocMeta?.pages as Record<string, unknown>[] | null) ?? null,
      });
    },
  });

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
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
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
        401: Type.Object({ error: Type.String() }),
        404: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const { entityId } = request.params;
      const { orgId } = request.query;
      const highlightsPage = request.query.highlightsPage ?? 1;
      const highlightsPageSize = clampPageSize(request.query.highlightsPageSize);
      const highlightsOffset = (highlightsPage - 1) * highlightsPageSize;

      const entity = await getDb().query.entities.findFirst({
        where: eq(entities.id, entityId),
      });
      if (!entity) {
        return reply.code(404).send({ error: "Entity not found" });
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

export default adminRoutes;
