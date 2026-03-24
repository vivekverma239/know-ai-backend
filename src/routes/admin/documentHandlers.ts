import { getDb } from "@/db";
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
} from "@/schemas/admin.schema";
import { getPdfStoragePathCandidates, resolveExistingPdfStoragePath } from "@/service/file/storagePath";
import { getStorage } from "@/service/googleStorage";
import { NotFoundError } from "@/utils/errorHandler";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import {
  type SQLWrapper,
  and,
  desc,
  eq,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { MAX_PAGE_SIZE, clampPageSize, toIsoOrNull } from "./utils";

export const registerDocumentHandlers = async (fastify: FastifyInstance) => {
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
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "list_documents",
        ip: request.ip,
      });

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
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "view_document",
        resourceId: request.params.id,
        ip: request.ip,
      });

      const file = await getDb().query.userFile.findFirst({
        where: eq(userFile.id, request.params.id),
      });
      if (!file) {
        throw new NotFoundError("Document not found");
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
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "view_document_pages",
        resourceId: request.params.id,
        ip: request.ip,
      });

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
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "view_document_page",
        resourceId: request.params.id,
        ip: request.ip,
      });

      const page = await getDb().query.userFilePage.findFirst({
        where: and(
          eq(userFilePage.fileId, request.params.id),
          eq(userFilePage.pageNumber, request.params.pageNumber),
        ),
      });
      if (!page) {
        throw new NotFoundError("Page not found");
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
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "view_document_sections",
        resourceId: request.params.id,
        ip: request.ip,
      });

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
          subsections: item.subsections ?? null,
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
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "view_document_chapters",
        resourceId: request.params.id,
        ip: request.ip,
      });

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
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "view_document_metadata",
        resourceId: request.params.id,
        ip: request.ip,
      });

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
        throw new NotFoundError("Document not found");
      }

      return reply.send({
        toc: (tocMeta?.toc as Record<string, unknown> | null) ?? null,
        extractedMetadata: (tocMeta?.metadata as Record<string, unknown> | null) ?? null,
        fileMetadata: (file.metadata as Record<string, unknown> | null) ?? null,
        pages: (tocMeta?.pages as Record<string, unknown>[] | null) ?? null,
      });
    },
  });
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
