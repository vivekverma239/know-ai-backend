import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  userFile,
  userFilePage,
  chunks,
  userFileCluster,
  userFileSection,
  userFileHeirarchialIndex,
  userFileChapter,
} from "../db/schema";
import { StorageService } from "../service/storage";
import {
  parsePDF,
  parsePDFChapters,
  parsePDFHeirarchialIndex,
  parsePDFMetadata,
} from "../service/pdfParsing";
import { logger } from "../utils/logger";
import { db } from "../db";
import {
  UserFileWithMetaSchema,
  SignedUrlResponse,
  FilePagesResponse,
  FileSectionsResponse,
  HierarchicalIndexItems,
  DeleteResponse,
  UserFileSchema,
} from "../schemas/file.schema";
import { chapterAgent } from "@/agents/fileAgent/chapter";
import { fileAgent } from "@/agents/fileAgent";

const fileRoutes = async (fastify: FastifyInstance) => {
  // List files with meta and filters
  fastify.get("/", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List user files with metadata",
      querystring: Type.Object({
        page: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
        pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        search: Type.Optional(Type.String()),
        status: Type.Optional(
          Type.Union([
            Type.Literal("all"),
            Type.Literal("pending"),
            Type.Literal("processing"),
            Type.Literal("processed"),
          ])
        ),
        userId: Type.String(),
        orgId: Type.String(),
      }),
      response: { 200: Type.Array(UserFileWithMetaSchema) },
    },
    handler: async (request, reply) => {
      // @ts-expect-error
      const userId: string = request.user.id;
      const { page = 1, pageSize = 25, search, status } = request.query as any;
      const _requestedUserId = (request.query as any).userId;
      const _orgId = (request.query as any).orgId;
      const offset = (page - 1) * pageSize;

      const whereConditions: any[] = [];
      if (status && status !== "all")
        whereConditions.push(eq(userFile.status, status));
      if ((search?.trim?.() ?? "") !== "") {
        const searchTerms = (search as string)
          .trim()
          .split(/\s+/)
          .filter((term) => term.length > 0);
        if (searchTerms.length > 0) {
          const searchConditions = searchTerms.map((term) => {
            const exactMatch = sql`(${userFile.name} ~* ${`\\b${term}\\b`})`;
            const partialMatch = sql`(${userFile.name} ILIKE ${`%${term}%`})`;
            const startsWith = sql`(${userFile.name} ILIKE ${`${term}%`})`;
            const endsWith = sql`(${userFile.name} ILIKE ${`%${term}`})`;
            return sql`(${sql.join(
              [exactMatch, partialMatch, startsWith, endsWith],
              sql` OR `
            )})`;
          });
          whereConditions.push(
            sql`(${sql.join(searchConditions, sql` AND `)})`
          );
        }
      }

      const userFiles = db
        .select()
        .from(userFile)
        .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
        .orderBy(desc(userFile.createdAt))
        .limit(pageSize)
        .offset(offset)
        .as("userFiles");

      const pageCount = db
        .select({
          documentId: userFilePage.fileId,
          count: count(userFilePage.id).as("pageCount"),
        })
        .from(userFilePage)
        .groupBy(userFilePage.fileId)
        .as("pageCount");
      const chunkCount = db
        .select({
          documentId: chunks.documentId,
          count: count(chunks.id).as("chunkCount"),
        })
        .from(chunks)
        .groupBy(chunks.documentId)
        .as("chunkCount");
      const chapterCount = db
        .select({
          documentId: userFileChapter.fileId,
          count: count(userFileChapter.id).as("chapterCount"),
        })
        .from(userFileChapter)
        .groupBy(userFileChapter.fileId)
        .as("chapterCount");

      const data = (await db
        .select({
          id: userFiles.id,
          name: userFiles.name,
          status: userFiles.status,
          metadata: userFiles.metadata,
          numPages: pageCount.count,
          numChunks: chunkCount.count,
          numChapters: chapterCount.count,
          createdAt: userFiles.createdAt,
          updatedAt: userFiles.updatedAt,
        })
        .from(userFiles)
        .leftJoin(pageCount, eq(userFiles.id, pageCount.documentId))
        .leftJoin(chunkCount, eq(userFiles.id, chunkCount.documentId))
        .leftJoin(chapterCount, eq(userFiles.id, chapterCount.documentId))
        .orderBy(desc(userFiles.createdAt))) as any[];

      return reply.send(data);
    },
  });

  // Get file details
  fastify.get<{ Params: { id: string } }>("/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get file details by id",
      params: Type.Object({ id: Type.String() }),
      response: { 200: UserFileSchema },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const [file] = await db
        .select()
        .from(userFile)
        .where(and(eq(userFile.id, id)));
      if (!file) return reply.code(404).send({ message: "File not found" });
      const storageService = new StorageService();
      const filePath = `files/${file.createdById}/${file.id}/${file.id}.pdf`;
      return reply.send({
        ...file,
        signedUrl: await storageService.getSignedUrl(filePath),
      });
    },
  });

  // Get pages
  fastify.get<{
    Querystring: { fileId: string; limit?: number; offset?: number };
  }>("/pages", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get pages for a file",
      querystring: Type.Object({
        fileId: Type.String(),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        offset: Type.Optional(Type.Number({ minimum: 0 })),
      }),
      response: { 200: FilePagesResponse },
    },
    handler: async (request, reply) => {
      const { fileId, limit = 10, offset = 0 } = request.query;
      const [pages, total] = await Promise.all([
        db.query.userFilePage.findMany({
          where: and(eq(userFilePage.fileId, fileId)),
          limit,
          offset,
          orderBy: (t, { asc }) => [asc(t.pageNumber)],
        }),
        db
          .select({ count: count() })
          .from(userFilePage)
          .where(eq(userFilePage.fileId, fileId))
          .then((r) => r[0]?.count ?? 0),
      ]);
      return reply.send({ pages, total });
    },
  });

  // Get chapters
  fastify.get<{ Querystring: { fileId: string } }>("/chapters", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get chapters for a file",
      querystring: Type.Object({ fileId: Type.String() }),
      response: {
        200: Type.Array(
          Type.Object({
            id: Type.String(),
            fileId: Type.String(),
            title: Type.String(),
            summary: Type.String(),
            startPage: Type.Number(),
            endPage: Type.Number(),
          })
        ),
      },
    },
    handler: async (request, reply) => {
      const { fileId } = request.query;
      const chapters = await db.query.userFileChapter.findMany({
        where: eq(userFileChapter.fileId, fileId),
      });
      return reply.send(chapters);
    },
  });

  // Get sections
  fastify.get<{
    Querystring: { fileId: string; limit?: number; offset?: number };
  }>("/sections", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get sections for a file",
      querystring: Type.Object({
        fileId: Type.String(),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        offset: Type.Optional(Type.Number({ minimum: 0 })),
      }),
      response: { 200: FileSectionsResponse },
    },
    handler: async (request, reply) => {
      const { fileId, limit = 10, offset = 0 } = request.query;
      const [sections, total] = await Promise.all([
        db.query.userFileSection.findMany({
          where: and(eq(userFileSection.fileId, fileId)),
          limit,
          offset,
          orderBy: (t, { asc }) => [asc(t.startPage)],
        }),
        db
          .select({ count: count() })
          .from(userFileSection)
          .where(eq(userFileSection.fileId, fileId))
          .then((r) => r[0]?.count ?? 0),
      ]);
      return reply.send({ sections, total });
    },
  });

  // Get hierarchical index
  fastify.get<{
    Querystring: {
      fileId: string;
      level?: number;
      limit?: number;
      offset?: number;
    };
  }>("/hierarchical-index", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get hierarchical index",
      querystring: Type.Object({
        fileId: Type.String(),
        level: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        offset: Type.Optional(Type.Number({ minimum: 0 })),
      }),
      response: { 200: HierarchicalIndexItems },
    },
    handler: async (request, reply) => {
      const { fileId, level, limit = 10, offset = 0 } = request.query;
      const items = await db.query.userFileHeirarchialIndex.findMany({
        where: and(
          eq(userFileHeirarchialIndex.fileId, fileId),
          level !== undefined
            ? eq(userFileHeirarchialIndex.level, level)
            : undefined
        ),
        limit,
        offset,
        orderBy: (t, { asc }) => [asc(t.startPage)],
      });
      return reply.send({ items });
    },
  });

  // Delete file
  fastify.delete<{ Params: { id: string } }>("/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Delete file by id",
      params: Type.Object({ id: Type.String() }),
      response: { 200: DeleteResponse },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      try {
        const file = await db.query.userFile.findFirst({
          where: and(eq(userFile.id, id)),
        });
        if (!file) return reply.code(404).send({ message: "File not found" });
        // @ts-expect-error
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const requesterId: string = request.user.id;
        if (file.createdById !== requesterId) {
          return reply.code(403).send({ message: "Forbidden" });
        }
        const filePath = `files/${requesterId}/${file.id}/${file.id}.pdf`;
        const storageService = new StorageService();
        try {
          await storageService.deleteFile(filePath);
        } catch {}
        await db.delete(userFileSection).where(eq(userFileSection.fileId, id));
        await db.delete(userFilePage).where(eq(userFilePage.fileId, id));
        await db.delete(chunks).where(eq(chunks.documentId, id));
        await db.delete(userFileCluster).where(eq(userFileCluster.fileId, id));
        await db.delete(userFileChapter).where(eq(userFileChapter.fileId, id));
        await db
          .delete(userFileHeirarchialIndex)
          .where(eq(userFileHeirarchialIndex.fileId, id));
        await db.delete(userFile).where(eq(userFile.id, id));
        return reply.send({ success: true });
      } catch (error) {
        logger.error(`Error deleting file: ${id} ${JSON.stringify(error)}`);
        return reply.code(500).send({ message: "Error deleting file" });
      }
    },
  });

  // Signed upload URL
  fastify.post<{ Body: { fileId: string } }>("/upload-url", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get signed upload URL",
      body: Type.Object({ fileId: Type.String() }),
      response: { 200: SignedUrlResponse },
    },
    handler: async (request, reply) => {
      // @ts-expect-error
      const userId: string = request.user.id;
      const { fileId } = request.body;
      const storageService = new StorageService();
      const signedUrl = await storageService.createUploadSignedUrl(
        `files/${userId}/${fileId}/${fileId}.pdf`
      );
      return reply.send({ signedUrl });
    },
  });

  // Create file record and trigger parsing
  fastify.post<{ Body: { fileId: string; name: string } }>("/", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Create file record and parse",
      body: Type.Object({ fileId: Type.String(), name: Type.String() }),
      response: { 201: UserFileSchema },
    },
    handler: async (request, reply) => {
      // @ts-expect-error
      const userId: string = request.user.id;
      const { fileId, name } = request.body;
      const file = await db
        .insert(userFile)
        .values({ id: fileId, name, createdById: userId });
      await parsePDF(fileId);
      return reply.code(201).send(file);
    },
  });

  // Agents
  fastify.get<{ Querystring: { query: string; fileId: string } }>(
    "/agent/file",
    {
      preHandler: fastify.authenticate,
      schema: {
        description: "File agent",
        querystring: Type.Object({
          query: Type.String(),
          fileId: Type.String(),
        }),
        response: { 200: Type.Any() },
      },
      handler: async (request, reply) => {
        const { query, fileId } = request.query;
        return reply.send(await fileAgent(query, fileId));
      },
    }
  );

  fastify.get<{ Querystring: { query: string; fileId: string } }>(
    "/agent/chapter",
    {
      preHandler: fastify.authenticate,
      schema: {
        description: "Chapter agent",
        querystring: Type.Object({
          query: Type.String(),
          fileId: Type.String(),
        }),
        response: { 200: Type.Any() },
      },
      handler: async (request, reply) => {
        const { query, fileId } = request.query;
        return reply.send(await chapterAgent(query, fileId));
      },
    }
  );
};

export default fileRoutes;
