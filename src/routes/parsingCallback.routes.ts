import type { ParsedPDF } from "@/@types/parsedData";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { SectionCallbackData } from "@/@types/fileIndex";
import type { DocumentMetadata } from "@/@types/metadata";
import type { CallbackTokenUsage } from "@/@types/tokenUsage";
import {
  updateOutline,
  updateParsedMetadata,
  updateParsedPages,
} from "@/service/file/parsing";
import { updateUsage } from "@/service/file/usage";
import { logError, logger } from "@/utils/logger";
import { resolveRequestId } from "@/utils/requestContext";
import { mapCallbackTokenUsage } from "@/utils/tokenUsage";

const parsingCallbackRoutes = async (fastify: FastifyInstance) => {
  // Global dispatcher for parsing callbacks
  fastify.post<{ Params: { fileId: string } }>(
    "/callbacks/parsing/:fileId",
    {
      schema: {
        description: "Global parsing callback dispatcher",
        tags: ["Callbacks"],
        params: Type.Object({ fileId: Type.String() }),
        body: Type.Object({
          status: Type.String(),
          task_type: Type.String(),
          data: Type.Unknown(),
          usage_metadata: Type.Optional(Type.Any()),
        }),
        response: { 200: Type.Object({ success: Type.Boolean() }) },
      },
      preHandler: async (request, reply) => {
        const expectedToken = process.env.BACKEND_TOKEN;
        if (!expectedToken) {
          request.log.error("BACKEND_TOKEN is not configured on the server");
          return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        const callbackToken = request.headers["x-callback-token"] as string | undefined;
        const authHeader = request.headers["authorization"] as string | undefined;
        const token =
          callbackToken ??
          (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);

        if (!token || token !== expectedToken) {
          request.log.warn("Invalid or missing callback token on parsing callback");
          return reply.code(401).send({ success: false, error: "Unauthorized" });
        }
      },
    },
    async (request, reply) => {
      const requestId = resolveRequestId(request);

      try {
        const { fileId } = request.params as { fileId: string };
        const { status, data, task_type, usage_metadata } = request.body as {
          status: string;
          data: ParsedPDF | DocumentMetadata | SectionCallbackData;
          task_type: string;
          usage_metadata: CallbackTokenUsage;
        };

        logger.info("File parsing callback received", {
          fileId,
          status,
          taskType: task_type,
          requestId,
        });

        // Process based on task type
        if (task_type === "parse_outline") {
          const section = data as SectionCallbackData;
          await updateOutline({
            chapters: section.chapters,
            title: section.title,
            summary: section.summary,
            fileId,
          });
          await updateUsage(fileId, mapCallbackTokenUsage(usage_metadata ?? {}));
        } else if (task_type === "parse_pdf") {
          const parsed = data as ParsedPDF;
          await updateParsedPages(fileId, parsed);
          await updateUsage(fileId, mapCallbackTokenUsage(usage_metadata ?? {}));
        } else if (task_type === "parse_metadata") {
          const parsed = data as DocumentMetadata;
          await updateParsedMetadata(fileId, parsed);
          await updateUsage(fileId, mapCallbackTokenUsage(usage_metadata ?? {}));
        } else {
          logger.warn("Unknown task type received in parsing callback", {
            taskType: task_type,
            fileId,
            requestId,
          });
        }

        logger.info("File parsing callback processed successfully", {
          fileId,
          taskType: task_type,
          requestId,
        });

        return reply.status(200).send({ success: true, requestId });
      } catch (error) {
        const body = request.body as { task_type?: string } | undefined;
        logError(error, {
          fileId: request.params.fileId,
          taskType: body?.task_type,
          operation: "parsingCallback",
          requestId,
        });

        return reply.code(500).send({
          success: false,
          error: "Failed to process parsing callback",
          requestId,
        });
      }
    },
  );
};

export default parsingCallbackRoutes;
