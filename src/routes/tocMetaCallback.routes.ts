import { parseToCMetaService } from "@/service/file/triggerParsing";
import { logError, logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import { Receiver } from "@upstash/qstash";
import type { FastifyInstance } from "fastify";

const tocMetaCallbackRoutes = async (fastify: FastifyInstance) => {
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  });

  fastify.post(
    "/",
    {
      config: {
        rawBody: true,
      },
      schema: {
        description: "QStash callback for ToC + metadata parsing",
        tags: ["Callbacks"],
        headers: Type.Object({
          "upstash-signature": Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          400: Type.Object({ success: Type.Boolean(), error: Type.Optional(Type.String()) }),
          500: Type.Object({ success: Type.Boolean(), error: Type.Optional(Type.String()) }),
        },
      },
    },
    async (request, reply) => {
      try {
        const signature = (request.headers["upstash-signature"] ??
          request.headers["Upstash-Signature"]) as string | undefined;
        if (!signature) {
          logger.warn("ToC meta callback: No signature provided");
          return reply.code(400).send({ success: false });
        }

        const bodyText =
          typeof request.rawBody === "string"
            ? request.rawBody
            : typeof request.body === "string"
              ? request.body
              : JSON.stringify(request.body ?? {});

        try {
          const isValid = await receiver.verify({ body: bodyText, signature });
          if (!isValid) {
            logger.warn("ToC meta callback: Invalid signature");
            return reply.code(400).send({ success: false });
          }
        } catch (err) {
          logger.error("ToC meta callback: Error verifying signature", {
            error: err instanceof Error ? err.message : String(err),
          });
          return reply.code(400).send({ success: false });
        }

        const { type, data } = JSON.parse(bodyText) as {
          type: string;
          data: { fileId?: string };
        };

        if (type !== "toc_meta_processing") {
          logger.warn("ToC meta callback: Invalid message type", { type });
          return reply.code(400).send({ success: false });
        }

        const fileId = data?.fileId;
        if (!fileId || typeof fileId !== "string") {
          logger.warn("ToC meta callback: Invalid or missing fileId", { fileId });
          return reply.code(400).send({ success: false });
        }

        logger.info("Starting ToC meta parsing via callback", { fileId });
        await parseToCMetaService(fileId);
        logger.info("ToC meta parsing completed", { fileId });

        return reply.send({ success: true });
      } catch (error) {
        logError(error, { operation: "tocMetaCallback" });
        return reply.code(500).send({ success: false });
      }
    },
  );
};

export default tocMetaCallbackRoutes;
