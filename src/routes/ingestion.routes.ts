import {
  RetryableIngestionError,
  type IngestionPayload,
  processIngestionEvent,
} from "@/service/ingestion";
import { logError, logger } from "@/utils/logger";
import { resolveRequestId } from "@/utils/requestContext";
import { Type } from "@sinclair/typebox";
import { Receiver } from "@upstash/qstash";
import type { FastifyInstance } from "fastify";

const INGESTION_DEBUG_ENABLED = ["1", "true", "yes", "on"].includes(
  (process.env.INGESTION_DEBUG ?? "").toLowerCase(),
);

const logIngestionDebug = (message: string, meta: Record<string, unknown> = {}) => {
  if (!INGESTION_DEBUG_ENABLED) return;
  logger.debug(message, meta);
};

const ingestionRoutes = async (fastify: FastifyInstance) => {
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  });

  fastify.post(
    "/webhooks/ingestion",
    {
      config: {
        rawBody: true,
      },
      schema: {
        description: "Webhook for ingesting events from the core app DB",
        tags: ["Webhooks"],
        headers: Type.Object({
          "upstash-signature": Type.Optional(Type.String()),
        }),
        body: Type.Object({
          id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
          data: Type.Record(Type.String(), Type.Unknown()),
          type: Type.String(),
          action: Type.Union([
            Type.Literal("insert"),
            Type.Literal("update"),
            Type.Literal("delete"),
          ]),
          timestamp: Type.String(),
        }),
        response: {
          200: Type.Object({
            success: Type.Boolean(),
            requestId: Type.Optional(Type.String()),
          }),
          400: Type.Object({
            success: Type.Boolean(),
            error: Type.String(),
            requestId: Type.Optional(Type.String()),
          }),
          500: Type.Object({
            success: Type.Boolean(),
            error: Type.String(),
            requestId: Type.Optional(Type.String()),
          }),
          503: Type.Object({
            success: Type.Boolean(),
            error: Type.String(),
            requestId: Type.Optional(Type.String()),
          }),
        },
      },
    },
    async (request, reply) => {
      const requestId = resolveRequestId(request);
      const startedAt = Date.now();

      try {
        // Verify signature from QStash
        const signature = (request.headers["upstash-signature"] ??
          request.headers["Upstash-Signature"]) as string | undefined;
        logIngestionDebug("Ingestion webhook request received", {
          requestId,
          path: request.url,
          method: request.method,
          hasSignature: Boolean(signature),
        });

        if (!signature) {
          logger.warn("Ingestion webhook: No signature provided", { requestId });
          return reply.code(400).send({ success: false, error: "No signature provided" });
        }

        const bodyText =
          typeof request.rawBody === "string"
            ? request.rawBody
            : typeof request.body === "string"
              ? request.body
              : JSON.stringify(request.body ?? {});

        const isValid = await receiver
          .verify({
            signature,
            body: bodyText,
          })
          .catch((err) => {
            logger.error("Ingestion webhook: Signature verification error", {
              error: err instanceof Error ? err.message : String(err),
              requestId,
            });
            return false;
          });
        logIngestionDebug("Ingestion webhook signature verification finished", {
          requestId,
          isValid,
        });

        if (!isValid) {
          logger.warn("Ingestion webhook: Invalid signature", { requestId });
          return reply.code(400).send({ success: false, error: "Invalid signature" });
        }

        const payload = request.body as IngestionPayload;

        logger.info("Ingestion webhook received", {
          type: payload.type,
          action: payload.action,
          requestId,
        });
        logIngestionDebug("Ingestion webhook payload accepted", {
          requestId,
          type: payload.type,
          action: payload.action,
          eventId: payload.id,
          dataKeys: Object.keys(payload.data ?? {}),
        });

        await processIngestionEvent(payload);
        logIngestionDebug("Ingestion webhook processed successfully", {
          requestId,
          type: payload.type,
          action: payload.action,
          durationMs: Date.now() - startedAt,
        });

        return reply.status(200).send({ success: true, requestId });
      } catch (error) {
        const payload = request.body as IngestionPayload;
        if (error instanceof RetryableIngestionError) {
          logger.warn("Ingestion webhook returning retryable failure", {
            type: payload?.type,
            action: payload?.action,
            reasons: error.reasons,
            requestId,
          });
          logIngestionDebug("Ingestion webhook returning retryable status", {
            requestId,
            type: payload?.type,
            action: payload?.action,
            reasons: error.reasons,
            durationMs: Date.now() - startedAt,
          });
          return reply.code(503).send({
            success: false,
            error: error.message,
            requestId,
          });
        }

        logError(error, {
          operation: "ingestionWebhook",
          type: payload?.type,
          action: payload?.action,
          requestId,
        });
        logIngestionDebug("Ingestion webhook returning non-retryable failure", {
          requestId,
          type: payload?.type,
          action: payload?.action,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });

        return reply.code(500).send({
          success: false,
          error: "Failed to process ingestion event",
          requestId,
        });
      }
    },
  );
};

export default ingestionRoutes;
