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
      const { fileId } = request.params;
      const { status, data, task_type, usage_metadata } = request.body as any;
      logger.info(
        `File ${fileId} parsing callback received, status: ${status}`
      );

      if (task_type === "parse_heirarchial_index") {
        await updateHeirarchialIndex(fileId, data as HeirarchialIndexData);
      } else if (task_type === "parse_outline") {
        await updateOutline({
          chapters: data.chapters,
          title: data.title,
          summary: data.summary,
          fileId,
        });
        await updateUsage(fileId, mapCallbackTokenUsage(usage_metadata ?? {}));
      } else if (task_type === "parse_pdf") {
        const parsed = data as ParsedPDF;
        await updateParsedPages(fileId, parsed);
        await updateUsage(fileId, mapCallbackTokenUsage(usage_metadata ?? {}));
      } else if (task_type === "parse_metadata") {
        await updateParsedMetadata(fileId, data as DocumentMetadata);
        await updateUsage(fileId, mapCallbackTokenUsage(usage_metadata ?? {}));
      }

      return reply.status(200).send({ success: true });
    }
  );
};

export default parsingCallbackRoutes;
