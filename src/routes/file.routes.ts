import { Type } from "@sinclair/typebox";
import { type SQLWrapper, and, count, desc, eq, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import {
  type UserFileStatus,
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFilePage,
  userFileSection,
} from "../db/schema";
import { buildFileAccessFilter } from "../db/queries/accessControl";
import {
  DeleteResponse,
  FilePagesResponse,
  FileSectionsResponse,
  FileUploadRequest,
  FileUploadResponse,
  SignedUrlResponse,
  UserFileSchema,
  UserFileWithMetaSchema,
} from "../schemas/file.schema";
import { enqueueDocumentParse } from "../service/file/enqueueDocumentParse";
import { invalidateStoragePathCache, resolveExistingPdfStoragePath } from "../service/file/storagePath";
import { getStorage } from "../service/googleStorage";
import { AuthenticationError, AuthorizationError, NotFoundError, ValidationError } from "../utils/errorHandler";
import { logger } from "../utils/logger";

// Helper function to check if user has access to a file
const checkFileAccess = async (fileId: string, userId: string, orgId: string) => {
  const file = await getDb().query.userFile.findFirst({
    where: and(
      eq(userFile.id, fileId),
      buildFileAccessFilter(userFile.userId, userFile.orgId, userFile.isAdminFile, userId, orgId),
    ),
  });
  return file;
};

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
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
        ),
      }),
      response: {
        200: Type.Array(UserFileWithMetaSchema),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AuthenticationError("Unauthorized");
      }
      const userId: string = user.id;
      const orgId: string = user.orgId;
      const {
        page = 1,
        pageSize = 25,
        search,
        status,
      } = request.query as {
        page?: number;
        pageSize?: number;
        search?: string;
        status?: UserFileStatus | "all";
      };
      const offset = (page - 1) * pageSize;

      const whereConditions: SQLWrapper[] = [
        buildFileAccessFilter(userFile.userId, userFile.orgId, userFile.isAdminFile, userId, orgId) as SQLWrapper,
      ];

      if (status && status !== "all")
        whereConditions.push(eq(userFile.status, status as UserFileStatus));
      if ((search?.trim?.() ?? "") !== "") {
        const searchTerms = search
          ?.trim()
          .split(/\s+/)
          .filter((term) => term.length > 0);
        if (searchTerms && searchTerms.length > 0) {
          const searchConditions = searchTerms.map((term) => {
            const exactMatch = sql`(${userFile.name} ~* ${`\\b${term}\\b`})`;
            const partialMatch = sql`(${userFile.name} ILIKE ${`%${term}%`})`;
            const startsWith = sql`(${userFile.name} ILIKE ${`${term}%`})`;
            const endsWith = sql`(${userFile.name} ILIKE ${`%${term}`})`;
            return sql`(${sql.join(
              [exactMatch, partialMatch, startsWith, endsWith],
              sql` OR `,
            )})` as SQLWrapper;
          });
          whereConditions.push(sql`(${sql.join(searchConditions, sql` AND `)})` as SQLWrapper);
        }
      }

      const userFiles = getDb()
        .select()
        .from(userFile)
        .where(and(...whereConditions))
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

      const data = await getDb()
        .select({
          id: userFiles.id,
          name: userFiles.name,
          userId: userFiles.userId,
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
        .orderBy(desc(userFiles.createdAt));

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
        throw new AuthenticationError("Unauthorized");
      }
      const userId = user.id;
      const orgId = user.orgId;
      const { id } = request.params as { id: string };
      const [file] = await getDb()
        .select()
        .from(userFile)
        .where(
          and(
            eq(userFile.id, id),
            buildFileAccessFilter(userFile.userId, userFile.orgId, userFile.isAdminFile, userId, orgId),
          ),
        );
      if (!file) throw new NotFoundError("File not found");
      const storageService = getStorage();
      const filePath = await resolveExistingPdfStoragePath(storageService, {
        id: file.id,
        userId: file.userId,
        orgId: file.orgId,
        isAdminFile: file.isAdminFile,
      });
      return reply.send({
        ...file,
        signedUrl: filePath ? await storageService.getSignedUrl(filePath) : null,
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
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AuthenticationError("Unauthorized");
      }
      const {
        fileId,
        limit = 10,
        offset = 0,
      } = request.query as {
        fileId: string;
        limit?: number;
        offset?: number;
      };

      // Check if user has access to the file
      const file = await checkFileAccess(fileId, user.id, user.orgId);
      if (!file) {
        throw new NotFoundError("File not found");
      }

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
          }),
        ),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AuthenticationError("Unauthorized");
      }
      const { fileId } = request.query as { fileId: string };

      // Check if user has access to the file
      const file = await checkFileAccess(fileId, user.id, user.orgId);
      if (!file) {
        throw new NotFoundError("File not found");
      }

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
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AuthenticationError("Unauthorized");
      }
      const {
        fileId,
        limit = 10,
        offset = 0,
      } = request.query as {
        fileId: string;
        limit?: number;
        offset?: number;
      };

      // Check if user has access to the file
      const file = await checkFileAccess(fileId, user.id, user.orgId);
      if (!file) {
        throw new NotFoundError("File not found");
      }

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

  // Delete file
  fastify.delete<{ Params: { id: string } }>("/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Delete file by id",
      tags: ["Files"],
      params: Type.Object({ id: Type.String() }),
      response: {
        200: DeleteResponse,
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AuthenticationError("Unauthorized");
      }
      const userId = user.id;
      const orgId = user.orgId;
      const { id } = request.params as { id: string };
      const file = await getDb().query.userFile.findFirst({
        where: and(
          eq(userFile.id, id),
          buildFileAccessFilter(userFile.userId, userFile.orgId, userFile.isAdminFile, userId, orgId),
        ),
      });
      if (!file) throw new NotFoundError("File not found");

      // Only file owner can delete their own files, or admins can delete admin files
      if (file.userId !== userId && !file.isAdminFile) {
        throw new AuthorizationError("Forbidden");
      }
      const filePath = file.isAdminFile
        ? `files/admin/${file.orgId}/${file.id}/document.pdf`
        : `files/${file.userId}/${file.id}/${file.id}.pdf`;
      const storageService = getStorage();
      invalidateStoragePathCache(id);
      try {
        await storageService.deleteFile(filePath);
      } catch (error) {
        logger.warn("Failed to delete file from storage (file may not exist)", {
          error: error instanceof Error ? error.message : String(error),
          filePath,
          fileId: file.id,
          operation: "deleteFile:storage",
        });
        // Continue with database cleanup even if storage deletion fails
      }
      await getDb().delete(userFileSection).where(eq(userFileSection.fileId, id));
      await getDb().delete(userFilePage).where(eq(userFilePage.fileId, id));
      await getDb().delete(chunks).where(eq(chunks.documentId, id));
      await getDb().delete(userFileCluster).where(eq(userFileCluster.fileId, id));
      await getDb().delete(userFileChapter).where(eq(userFileChapter.fileId, id));
      await getDb().delete(userFile).where(eq(userFile.id, id));
      return reply.send({ success: true });
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
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthenticationError("Unauthorized");
      }
      const { fileId } = request.body;
      const storageService = getStorage();
      const signedUrl = await storageService.createUploadSignedUrl(
        `files/${userId}/${fileId}/document.pdf`,
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
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AuthenticationError("Unauthorized");
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
      await enqueueDocumentParse(fileId);
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
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AuthenticationError("Unauthorized");
      }

      const userId: string = user.id;
      const orgId: string = user.orgId;
      const fileId = uuidv4();

      // Get the uploaded file from the request
      const data = await request.file();

      if (!data) {
        throw new ValidationError("No file uploaded");
      }

      // Validate file type
      if (data.mimetype !== "application/pdf") {
        throw new ValidationError("File must be a PDF document");
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

      // Trigger parsing via parse-engine (async via QStash)
      enqueueDocumentParse(fileId).catch((error) => {
        logger.error(`Error enqueuing parse for file ${fileId}:`, error as Record<string, unknown>);
        getDb()
          .update(userFile)
          .set({ status: "failed" })
          .where(eq(userFile.id, fileId))
          .catch((updateError) => {
            logger.error(
              `Error updating file status for ${fileId}:`,
              updateError as Record<string, unknown>,
            );
          });
      });

      return reply.code(201).send({
        fileId,
        name: fileName,
        status: "pending",
        message: "File uploaded successfully and parsing started",
      });
    },
  });

  // Admin file upload endpoint
  fastify.post("/admin/upload", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Upload admin file (visible to all users in org)",
      tags: ["Files"],
      consumes: ["multipart/form-data"],
      response: {
        201: FileUploadResponse,
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AuthenticationError("Unauthorized");
      }

      // TODO: Add admin role check here
      // For now, we'll allow any authenticated user to upload admin files
      // In production, you should verify the user has admin privileges

      const userId: string = user.id;
      const orgId: string = user.orgId;
      const fileId = uuidv4();

      // Get the uploaded file from the request
      const data = await request.file();

      if (!data) {
        throw new ValidationError("No file uploaded");
      }

      // Validate file type
      if (data.mimetype !== "application/pdf") {
        throw new ValidationError("File must be a PDF document");
      }

      // Get file buffer
      const fileBuffer = await data.toBuffer();
      const fileName = data.filename || `admin-document-${Date.now()}.pdf`;

      // Upload to Google Cloud Storage with admin path
      const storageService = getStorage();
      const filePath = `files/admin/${orgId}/${fileId}/document.pdf`;

      await storageService.uploadFile({
        path: filePath,
        data: fileBuffer,
        contentType: "application/pdf",
      });

      // Create admin file record in database
      const file = await getDb()
        .insert(userFile)
        .values({
          id: fileId,
          name: fileName,
          userId: "admin",
          orgId: orgId,
          isAdminFile: true,
          status: "pending",
        })
        .returning();

      // Trigger parsing via parse-engine (async via QStash)
      enqueueDocumentParse(fileId).catch((error) => {
        logger.error(`Error enqueuing parse for admin file ${fileId}:`, error as Record<string, unknown>);
        getDb()
          .update(userFile)
          .set({ status: "failed" })
          .where(eq(userFile.id, fileId))
          .catch((updateError) => {
            logger.error(
              `Error updating admin file status for ${fileId}:`,
              updateError as Record<string, unknown>,
            );
          });
      });

      return reply.code(201).send({
        fileId,
        name: fileName,
        status: "pending",
        isAdminFile: true,
        message: "Admin file uploaded successfully and parsing started",
      });
    },
  });
  // Get citation details — enriches citation references with file data and signed URLs
  fastify.post<{
    Body: {
      citations: Array<{ fileId: string; pageNumbers: number[] }>;
    };
  }>("/citations", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get enriched citation details with signed URLs and page content",
      tags: ["Files"],
      body: Type.Object({
        citations: Type.Array(
          Type.Object({
            fileId: Type.String(),
            pageNumbers: Type.Array(Type.Number()),
          }),
        ),
      }),
      response: {
        200: Type.Object({
          citations: Type.Array(
            Type.Object({
              fileId: Type.String(),
              title: Type.String(),
              summary: Type.String(),
              type: Type.String(),
              signedUrl: Type.Optional(Type.String()),
              pages: Type.Array(
                Type.Object({
                  pageNumber: Type.Number(),
                  content: Type.String(),
                }),
              ),
            }),
          ),
        }),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AuthenticationError("Unauthorized");
      }
      const { citations } = request.body;

      const results = await Promise.all(
        citations.map(async (citation) => {
          const file = await checkFileAccess(citation.fileId, user.id, user.orgId);
          if (!file) {
            return {
              fileId: citation.fileId,
              title: "Unknown",
              summary: "",
              type: "unknown",
              signedUrl: undefined,
              pages: [],
            };
          }

          // Get signed URL for PDF files
          let signedUrl: string | undefined;
          if (file.type === "pdf") {
            try {
              const storage = getStorage();
              const gcsPath = await resolveExistingPdfStoragePath(storage, {
                id: file.id,
                userId: file.userId,
                orgId: file.orgId,
                isAdminFile: file.isAdminFile,
              });
              if (gcsPath) {
                signedUrl = await storage.getSignedUrl(gcsPath);
              }
            } catch {
              // Skip signed URL if resolution fails
            }
          }

          // Get page content for requested pages
          const pages = citation.pageNumbers.length > 0
            ? await getDb()
                .select({
                  pageNumber: userFilePage.pageNumber,
                  content: userFilePage.content,
                })
                .from(userFilePage)
                .where(
                  and(
                    eq(userFilePage.fileId, citation.fileId),
                    sql`${userFilePage.pageNumber} = ANY(${citation.pageNumbers})`,
                  ),
                )
            : [];

          return {
            fileId: file.id,
            title: file.metadata?.title ?? file.name ?? "Untitled",
            summary: file.metadata?.shortSummary ?? file.metadata?.summary ?? "",
            type: file.type ?? "pdf",
            signedUrl,
            pages,
          };
        }),
      );

      return reply.send({ citations: results });
    },
  });
};

export default fileRoutes;
