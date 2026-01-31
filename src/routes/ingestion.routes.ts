import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { Receiver } from "@upstash/qstash";
import { logger, logError } from "@/utils/logger";
import { getRequestId } from "@/utils/requestContext";
import { processIngestionEvent, type IngestionPayload } from "@/service/ingestion";

const ingestionRoutes = async (fastify: FastifyInstance) => {
    const receiver = new Receiver({
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
    });

    fastify.post(
        "/webhooks/ingestion",
        {
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
                    200: Type.Object({ success: Type.Boolean(), requestId: Type.String() }),
                    400: Type.Object({ success: Type.Boolean(), error: Type.String() }),
                    500: Type.Object({ success: Type.Boolean(), error: Type.String(), requestId: Type.String() }),
                },
            },
        },
        async (request, reply) => {
            const requestId = getRequestId();

            try {
                // Verify signature from QStash
                const signature = (request.headers["upstash-signature"] ??
                    request.headers["Upstash-Signature"]) as string | undefined;

                if (!signature) {
                    logger.warn("Ingestion webhook: No signature provided", { requestId });
                    return reply.code(400).send({ success: false, error: "No signature provided" });
                }

                const bodyText = typeof request.body === "string"
                    ? request.body
                    : JSON.stringify(request.body);

                const isValid = await receiver.verify({
                    signature,
                    body: bodyText,
                }).catch((err) => {
                    logger.error("Ingestion webhook: Signature verification error", {
                        error: err instanceof Error ? err.message : String(err),
                        requestId,
                    });
                    return false;
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

                await processIngestionEvent(payload);

                return reply.status(200).send({ success: true, requestId });
            } catch (error) {
                const payload = request.body as IngestionPayload;
                logError(error, {
                    operation: "ingestionWebhook",
                    type: payload?.type,
                    action: payload?.action,
                    requestId,
                });

                return reply.code(500).send({
                    success: false,
                    error: "Failed to process ingestion event",
                    requestId,
                });
            }
        }
    );
};

export default ingestionRoutes;
