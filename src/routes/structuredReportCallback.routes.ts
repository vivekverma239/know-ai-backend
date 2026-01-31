import type { QstashMessage } from "@/@types/queue";
import { processStructuredReportWithObserver } from "@/agents/report/structuredReport";
import { getDb } from "@/db";
import { structuredReports } from "@/db/schema";
import { createContextLogger } from "@/utils/logger";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export interface StructuredReportProcessingData {
  reportId: string;
  reprocess?: boolean;
}

const structuredReportCallbackRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/", async (request, reply) => {
    const logger = createContextLogger({
      route: "structured-report-callback",
    });

    try {
      // Qstash verification would go here (similar to other callback routes)
      // For now, assuming it's called by Qstash

      const body = request.body as QstashMessage<StructuredReportProcessingData>;

      if (body.type !== "structured_report_processing") {
        return reply.status(400).send({ error: "Invalid message type" });
      }

      const { reportId, reprocess = false } = body.data;

      logger.info("📥 Received callback for report", { reportId, reprocess });

      const report = await getDb().query.structuredReports.findFirst({
        where: eq(structuredReports.id, reportId),
      });

      if (!report) {
        logger.error("❌ Report not found", { reportId });
        return reply.status(404).send({ error: "Report not found" });
      }

      // Process in background (don't await)
      processStructuredReportWithObserver({ reportId, reprocess })
        .then(() => {
          logger.info("✅ Report processed successfully", { reportId });
        })
        .catch((error) => {
          logger.error("❌ Report processing failed", {
            reportId,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return reply.status(200).send({ status: "processing" });
    } catch (error) {
      logger.error("❌ Callback error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return reply.status(500).send({ error: "Internal server error" });
    }
  });
};

export default structuredReportCallbackRoutes;
