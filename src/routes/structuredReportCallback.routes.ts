import type { QstashMessage } from "@/@types/queue";
import { assessReportReadiness } from "@/agents/report/readinessAgent";
import { processStructuredReportWithObserver } from "@/agents/report/structuredReport";
import { getDb } from "@/db";
import { structuredReportTemplate, structuredReports } from "@/db/schema";
import { createContextLogger } from "@/utils/logger";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export interface StructuredReportProcessingData {
  reportId: string;
  reprocess?: boolean;
  skipPreflight?: boolean;
}

const structuredReportCallbackRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/", async (request, reply) => {
    const logger = createContextLogger({
      route: "structured-report-callback",
    });

    try {
      const body = request.body as QstashMessage<StructuredReportProcessingData>;

      if (body.type !== "structured_report_processing") {
        return reply.status(400).send({ error: "Invalid message type" });
      }

      const { reportId, reprocess = false, skipPreflight = false } = body.data;

      logger.info("Received callback for report", { reportId, reprocess, skipPreflight });

      const report = await getDb().query.structuredReports.findFirst({
        where: eq(structuredReports.id, reportId),
      });

      if (!report) {
        logger.error("Report not found", { reportId });
        return reply.status(404).send({ error: "Report not found" });
      }

      // Block processing if report is currently indexing (unless the indexing workflow is resuming)
      if (report.status === "indexing" && !skipPreflight) {
        logger.warn("Report is still indexing, skipping processing", { reportId });
        return reply.status(409).send({ error: "Report is still indexing" });
      }

      // If skipPreflight or reprocessing, go directly to the pipeline
      if (skipPreflight || reprocess) {
        processStructuredReportWithObserver({ reportId, reprocess })
          .then(() => {
            logger.info("Report processed successfully", { reportId });
          })
          .catch((error) => {
            logger.error("Report processing failed", {
              reportId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return reply.status(200).send({ status: "processing" });
      }

      // Run readiness agent as Step 0
      const template = await getDb().query.structuredReportTemplate.findFirst({
        where: eq(structuredReportTemplate.id, report.templateId),
      });

      if (!template) {
        logger.error("Template not found", { templateId: report.templateId });
        await getDb()
          .update(structuredReports)
          .set({ status: "failed" })
          .where(eq(structuredReports.id, reportId));
        return reply.status(200).send({ status: "failed" });
      }

      const prompts = template.prompts as Record<string, string>;

      // Run readiness assessment in background
      (async () => {
        try {
          const preflightResult = await assessReportReadiness({
            topic: report.topic,
            referencePeriod: report.referencePeriod ?? "",
            taskDescription: template.taskDescription,
            initialResearchPrompt: prompts.initialResearchPrompt ?? "",
            userId: report.userId,
            orgId: "",
          });

          if (preflightResult.sufficient) {
            // Data is sufficient — proceed directly to pipeline
            await getDb()
              .update(structuredReports)
              .set({ preflightResult })
              .where(eq(structuredReports.id, reportId));

            await processStructuredReportWithObserver({ reportId, reprocess: false });
            logger.info("Report processed successfully (sufficient data)", { reportId });
          } else {
            // Data insufficient — pause for user review
            await getDb()
              .update(structuredReports)
              .set({
                status: "awaiting_review",
                preflightResult,
              })
              .where(eq(structuredReports.id, reportId));

            logger.info("Report paused for review (insufficient data)", {
              reportId,
              score: preflightResult.score,
              gapCount: preflightResult.gaps.length,
            });
          }
        } catch (error) {
          logger.error("Readiness assessment failed", {
            reportId,
            error: error instanceof Error ? error.message : String(error),
          });
          await getDb()
            .update(structuredReports)
            .set({ status: "failed" })
            .where(eq(structuredReports.id, reportId));
        }
      })();

      return reply.status(200).send({ status: "processing" });
    } catch (error) {
      logger.error("Callback error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return reply.status(500).send({ error: "Internal server error" });
    }
  });
};

export default structuredReportCallbackRoutes;
