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
import { getStorage } from "../service/googleStorage";
import {
  parsePDF,
  parsePDFChapters,
  parsePDFHeirarchialIndex,
  parsePDFMetadata,
} from "../service/file/triggerParsing";
import { logger } from "../utils/logger";
import { getDb } from "../db";
import {
  UserFileWithMetaSchema,
  SignedUrlResponse,
  FilePagesResponse,
  FileSectionsResponse,
  HierarchicalIndexItems,
  DeleteResponse,
  UserFileSchema,
  FileUploadRequest,
  FileUploadResponse,
} from "../schemas/file.schema";
import { chapterAgent } from "@/agents/fileAgent/chapter";
import { fileAgent } from "@/agents/fileAgent";
import { v4 as uuidv4 } from "uuid";

const fileRoutes = async (fastify: FastifyInstance) => {
  // List files with meta and filters
  fastify.get("/", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List user files with metadata",
      tags: ["Files"],
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
      }),
      response: {
        200: Type.Array(UserFileWithMetaSchema),
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const userId: string = user.id;
      const orgId: string = user.orgId;
      const { page = 1, pageSize = 25, search, status } = request.query as any;
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

      const userFiles = getDb()
        .select()
        .from(userFile)
        .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
        .orderBy(desc(userFile.createdAt))
        .limit(pageSize)
        .offset(offset)
        .as("userFiles");

      const pageCount = getDb()
        .select({
          documentId: userFilePage.fileId,
          count: count(userFilePage.id).as("pageCount"),
        })
        .from(userFilePage)
        .groupBy(userFilePage.fileId)
        .as("pageCount");
      const chunkCount = getDb()
        .select({
          documentId: chunks.documentId,
          count: count(chunks.id).as("chunkCount"),
        })
        .from(chunks)
        .groupBy(chunks.documentId)
        .as("chunkCount");
      const chapterCount = getDb()
        .select({
          documentId: userFileChapter.fileId,
          count: count(userFileChapter.id).as("chapterCount"),
        })
        .from(userFileChapter)
        .groupBy(userFileChapter.fileId)
        .as("chapterCount");

      const data = (await getDb()
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
      tags: ["Files"],
      params: Type.Object({ id: Type.String() }),
      response: { 200: UserFileSchema },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const { id } = request.params as any;
      const [file] = await getDb()
        .select()
        .from(userFile)
        .where(and(eq(userFile.id, id)));
      if (!file) return reply.code(404).send({ message: "File not found" });
      const storageService = getStorage();
      const filePath = `files/${file.userId}/${file.id}/${file.id}.pdf`;
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
      tags: ["Files"],
      querystring: Type.Object({
        fileId: Type.String(),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        offset: Type.Optional(Type.Number({ minimum: 0 })),
      }),
      response: {
        200: FilePagesResponse,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const { fileId, limit = 10, offset = 0 } = request.query as any;
      const [pages, total] = await Promise.all([
        getDb().query.userFilePage.findMany({
          where: and(eq(userFilePage.fileId, fileId)),
          limit,
          offset,
          orderBy: (t, { asc }) => [asc(t.pageNumber)],
        }),
        getDb()
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
      tags: ["Files"],
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
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const { fileId } = request.query as any;
      const chapters = await getDb().query.userFileChapter.findMany({
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
      tags: ["Files"],
      querystring: Type.Object({
        fileId: Type.String(),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        offset: Type.Optional(Type.Number({ minimum: 0 })),
      }),
      response: {
        200: FileSectionsResponse,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const { fileId, limit = 10, offset = 0 } = request.query as any;
      const [sections, total] = await Promise.all([
        getDb().query.userFileSection.findMany({
          where: and(eq(userFileSection.fileId, fileId)),
          limit,
          offset,
          orderBy: (t, { asc }) => [asc(t.startPage)],
        }),
        getDb()
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
      tags: ["Files"],
      querystring: Type.Object({
        fileId: Type.String(),
        level: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        offset: Type.Optional(Type.Number({ minimum: 0 })),
      }),
      response: {
        200: HierarchicalIndexItems,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const { fileId, level, limit = 10, offset = 0 } = request.query;
      const items = await getDb().query.userFileHeirarchialIndex.findMany({
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
      tags: ["Files"],
      params: Type.Object({ id: Type.String() }),
      response: {
        200: DeleteResponse,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const { id } = request.params as any;
      try {
        const file = await getDb().query.userFile.findFirst({
          where: and(eq(userFile.id, id)),
        });
        if (!file) return reply.code(404).send({ message: "File not found" });
        // @ts-expect-error
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const requesterId: string = request.user.id;
        if (file.userId !== requesterId) {
          return reply.code(403).send({ message: "Forbidden" });
        }
        const filePath = `files/${requesterId}/${file.id}/${file.id}.pdf`;
        const storageService = getStorage();
        try {
          await storageService.deleteFile(filePath);
        } catch {}
        await getDb()
          .delete(userFileSection)
          .where(eq(userFileSection.fileId, id));
        await getDb().delete(userFilePage).where(eq(userFilePage.fileId, id));
        await getDb().delete(chunks).where(eq(chunks.documentId, id));
        await getDb()
          .delete(userFileCluster)
          .where(eq(userFileCluster.fileId, id));
        await getDb()
          .delete(userFileChapter)
          .where(eq(userFileChapter.fileId, id));
        await getDb()
          .delete(userFileHeirarchialIndex)
          .where(eq(userFileHeirarchialIndex.fileId, id));
        await getDb().delete(userFile).where(eq(userFile.id, id));
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
      tags: ["Files"],
      body: Type.Object({ fileId: Type.String() }),
      response: {
        200: SignedUrlResponse,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      // @ts-expect-error
      const userId: string = request.user.id;
      const { fileId } = request.body;
      const storageService = getStorage();
      const signedUrl = await storageService.createUploadSignedUrl(
        `files/${userId}/${fileId}/document.pdf`
      );
      return reply.send({
        signedUrl,
        fileId,
      });
    },
  });

  // Parse PDF
  fastify.post<{ Body: { fileId: string } }>("/parse-async", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Parse PDF",
      tags: ["Files"],
      body: Type.Object({ fileId: Type.String() }),
      response: {
        201: UserFileSchema,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const userId: string = user.id;
      const orgId: string = user.orgId;
      const { fileId } = request.body;
      const file = await getDb().insert(userFile).values({
        id: fileId,
        name: fileId,
        userId: userId,
        orgId: orgId,
      });
      await parsePDF(fileId);
      return reply.code(201).send(file);
    },
  });

  // Upload file via form data
  fastify.post("/upload", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Upload and parse PDF file",
      tags: ["Files"],
      consumes: ["multipart/form-data"],
      //   body: {
      //     type: "object",
      //     properties: {
      //       file: { type: "object" },
      //       description: { type: "string" },
      //     },
      //   },
      response: {
        201: FileUploadResponse,
        400: Type.Object({ error: Type.String() }),
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      console.log("Uploading file");
      const user = request.user;
      console.log("User", user);
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const userId: string = user.id;
      const orgId: string = user.orgId;
      const fileId = uuidv4();

      try {
        // Get the uploaded file from the request
        const data = await request.file();

        if (!data) {
          return reply.code(400).send({ error: "No file uploaded" });
        }

        // Validate file type
        if (data.mimetype !== "application/pdf") {
          return reply.code(400).send({ error: "File must be a PDF document" });
        }

        // Get file buffer
        const fileBuffer = await data.toBuffer();
        const fileName = data.filename || `document-${Date.now()}.pdf`;

        // Upload to Google Cloud Storage
        const storageService = getStorage();
        const filePath = `files/${userId}/${fileId}/document.pdf`;

        await storageService.uploadFile({
          path: filePath,
          data: fileBuffer,
          contentType: "application/pdf",
        });

        // Create file record in database
        const file = await getDb()
          .insert(userFile)
          .values({
            id: fileId,
            name: fileName,
            userId: userId,
            orgId: orgId,
            status: "pending",
          })
          .returning();

        // Trigger parsing asynchronously
        parsePDF(fileId).catch((error) => {
          logger.error(`Error parsing file ${fileId}:`, error);
          // Update file status to error
          getDb()
            .update(userFile)
            .set({ status: "failed" })
            .where(eq(userFile.id, fileId))
            .catch((updateError) => {
              logger.error(
                `Error updating file status for ${fileId}:`,
                updateError
              );
            });
        });

        return reply.code(201).send({
          fileId,
          name: fileName,
          status: "pending",
          message: "File uploaded successfully and parsing started",
        });
      } catch (error) {
        console.log("Error uploading file", error);
        logger.error(`Error uploading file:`, { error });
        return reply.code(400).send({
          error:
            error instanceof Error ? error.message : "Failed to upload file",
        });
      }
    },
  });
};

export default fileRoutes;
