import { getEmbeddings } from "@/ai-backend/embeddings";
import { getDb } from "@/db";
import {
  type ModelConfig,
  structuredReportTemplate,
  structuredReports,
  userFile,
} from "@/db/schema";
import { sendQstashMessage } from "@/service/qstash";
import { startIndexingAndWait } from "@/service/reportIndexingWorkflow";
import { AuthenticationError, NotFoundError } from "@/utils/errorHandler";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import { and, count, desc, eq, getTableColumns } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const structuredReportRoutes = async (fastify: FastifyInstance) => {
  // Create template
  fastify.post("/templates", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Create a structured report template",
      tags: ["Structured Reports"],
      body: Type.Object({
        title: Type.String(),
        taskDescription: Type.String(),
        prompts: Type.Object({
          initialResearchPrompt: Type.String(),
          subQuestionsIdentificationPrompt: Type.String(),
          finalReportPrompt: Type.String(),
        }),
      }),
    },
    handler: async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) throw new AuthenticationError("Unauthorized");
      const body = request.body as {
        title: string;
        taskDescription: string;
        prompts: {
          initialResearchPrompt: string;
          subQuestionsIdentificationPrompt: string;
          finalReportPrompt: string;
        };
      };
      const [template] = await getDb()
        .insert(structuredReportTemplate)
        .values({
          userId,
          title: body.title,
          taskDescription: body.taskDescription,
          prompts: body.prompts,
        })
        .returning();
      return template;
    },
  });

  // List templates
  fastify.get("/templates", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List all structured report templates",
      tags: ["Structured Reports"],
    },
    handler: async (request, reply) => {
      const templates = await getDb()
        .select()
        .from(structuredReportTemplate)
        .orderBy(desc(structuredReportTemplate.id));
      return templates;
    },
  });

  // --- Reports ---

  // Create report
  fastify.post("/reports", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Create a new structured report",
      tags: ["Structured Reports"],
      body: Type.Object({
        templateId: Type.String(),
        topic: Type.String(),
        referencePeriod: Type.Optional(Type.String()),
        modelConfig: Type.Optional(Type.Any()),
      }),
    },
    handler: async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) throw new AuthenticationError("Unauthorized");
      const body = request.body as {
        templateId: string;
        topic: string;
        referencePeriod?: string;
        modelConfig?: ModelConfig;
      };

      const [report] = await getDb()
        .insert(structuredReports)
        .values({
          userId,
          templateId: body.templateId,
          topic: body.topic,
          referencePeriod: body.referencePeriod ?? null,
          status: "pending",
          modelConfig: body.modelConfig ?? null,
        })
        .returning();

      // Queue processing
      try {
        await sendQstashMessage("api/structured-report-callback", {
          type: "structured_report_processing",
          data: { reportId: report.id },
        });
      } catch (error) {
        logger.error("Failed to queue report", { error });
        await getDb()
          .update(structuredReports)
          .set({ status: "failed" })
          .where(eq(structuredReports.id, report.id));
      }

      return report;
    },
  });

  // Get report by ID
  fastify.get("/reports/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get structured report by ID",
      tags: ["Structured Reports"],
      params: Type.Object({ id: Type.String() }),
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const report = await getDb().query.structuredReports.findFirst({
        where: eq(structuredReports.id, id),
      });
      if (!report) throw new NotFoundError("Report not found");
      return report;
    },
  });

  // List reports
  fastify.get("/reports", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List structured reports",
      tags: ["Structured Reports"],
    },
    handler: async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) throw new AuthenticationError("Unauthorized");
      const reports = await getDb()
        .select({
          ...getTableColumns(structuredReports),
          templateName: structuredReportTemplate.title,
        })
        .from(structuredReports)
        .where(eq(structuredReports.userId, userId))
        .leftJoin(
          structuredReportTemplate,
          eq(structuredReports.templateId, structuredReportTemplate.id),
        )
        .orderBy(desc(structuredReports.id));
      return reports;
    },
  });

  // Get preflight result for a report
  fastify.get("/reports/:id/preflight", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get preflight readiness assessment for a report",
      tags: ["Structured Reports"],
      params: Type.Object({ id: Type.String() }),
    },
    handler: async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) throw new AuthenticationError("Unauthorized");
      const { id } = request.params as { id: string };

      const report = await getDb().query.structuredReports.findFirst({
        where: and(eq(structuredReports.id, id), eq(structuredReports.userId, userId)),
      });
      if (!report) throw new NotFoundError("Report not found");

      return reply.send({
        status: report.status,
        preflightResult: report.preflightResult ?? null,
        selectedRecommendations: report.selectedRecommendations ?? null,
      });
    },
  });

  // Continue report after review
  fastify.post("/reports/:id/continue", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Continue report generation after preflight review",
      tags: ["Structured Reports"],
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({
        selectedRecommendations: Type.Optional(
          Type.Array(
            Type.Object({
              url: Type.String(),
              title: Type.String(),
              type: Type.Union([Type.Literal("pdf"), Type.Literal("web_article")]),
            }),
          ),
        ),
        skipRecommendations: Type.Optional(Type.Boolean()),
      }),
    },
    handler: async (request, reply) => {
      const userId = request.user?.id;
      const orgId = request.user?.orgId ?? "";
      if (!userId) throw new AuthenticationError("Unauthorized");
      const { id } = request.params as { id: string };

      const report = await getDb().query.structuredReports.findFirst({
        where: and(eq(structuredReports.id, id), eq(structuredReports.userId, userId)),
      });
      if (!report) throw new NotFoundError("Report not found");

      if (report.status !== "awaiting_review") {
        return reply.status(400).send({
          error: `Report is not awaiting review (current status: ${report.status})`,
        });
      }

      const body = request.body as {
        selectedRecommendations?: { url: string; title: string; type: "pdf" | "web_article" }[];
        skipRecommendations?: boolean;
      };

      if (body.skipRecommendations || !body.selectedRecommendations?.length) {
        // Skip recommendations — proceed directly to pipeline
        try {
          await sendQstashMessage("api/structured-report-callback", {
            type: "structured_report_processing",
            data: { reportId: id, skipPreflight: true },
          });
        } catch (error) {
          logger.error("Failed to queue report continuation", { error });
          await getDb()
            .update(structuredReports)
            .set({ status: "failed" })
            .where(eq(structuredReports.id, id));
          return reply.status(500).send({ error: "Failed to queue report" });
        }

        return reply.send({ status: "processing", message: "Report generation resumed" });
      }

      // Set status to indexing immediately so the UI reflects the change
      await getDb()
        .update(structuredReports)
        .set({ status: "indexing" })
        .where(eq(structuredReports.id, id));

      // Start indexing workflow in background
      startIndexingAndWait({
        reportId: id,
        recommendations: body.selectedRecommendations,
        userId,
        orgId,
      }).catch((error) => {
        logger.error("Indexing workflow failed", {
          reportId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        getDb()
          .update(structuredReports)
          .set({ status: "failed" })
          .where(eq(structuredReports.id, id));
      });

      return reply.send({
        status: "indexing",
        message: "Sources are being indexed. Report will resume automatically.",
      });
    },
  });
};

export default structuredReportRoutes;
