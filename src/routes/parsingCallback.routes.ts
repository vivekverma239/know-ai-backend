import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { ParsedPDF } from "@/@types/parsedData";
import type { HeirarchialIndexData } from "@/@types/heirarchialIndex";

import type { DocumentMetadata } from "@/@types/metadata";
import { mapCallbackTokenUsage } from "@/utils/tokenUsage";
import { logger } from "@/utils/logger";
import {
  updateOutline,
  updateHeirarchialIndex,
  updateParsedMetadata,
  updateParsedPages,
} from "@/service/file/parsing";
import { updateUsage } from "@/service/file/usage";
import type { CallbackTokenUsage } from "@/@types/tokenUsage";
import type { SectionCallbackData } from "@/@types/fileIndex";

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
    },
    async (request, reply) => {
      const { fileId } = request.params as { fileId: string };
      const { status, data, task_type, usage_metadata } = request.body as {
        status: string;
        data:
          | HeirarchialIndexData
          | ParsedPDF
          | DocumentMetadata
          | SectionCallbackData;
        task_type: string;
        usage_metadata: CallbackTokenUsage;
      };
      logger.info(
        `File ${fileId} parsing callback received, status: ${status}`
      );

      if (task_type === "parse_heirarchial_index") {
        await updateHeirarchialIndex(fileId, data as HeirarchialIndexData);
      } else if (task_type === "parse_outline") {
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
      }

      return reply.status(200).send({ success: true });
    }
  );
};

export default parsingCallbackRoutes;
