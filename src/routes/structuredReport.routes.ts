import { getEmbeddings } from "@/ai-backend/embeddings";
import { getDb } from "@/db";
import {
  type ModelConfig,
  structuredReportTemplate,
  structuredReports,
  userFile,
} from "@/db/schema";
import { sendQstashMessage } from "@/service/qstash";
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
};

export default structuredReportRoutes;
