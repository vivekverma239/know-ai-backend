import type { Message as SQLMessage } from "@/@types";
import { MODELS } from "@/@types/llm";
import { type FinAgentUIMessage, finAgent } from "@/agents/finAgent";
import { getDb } from "@/db";
import { organizationMembers } from "@/db/external_schema";
import { getSessionWithMessages, syncMessages } from "@/db/queries/message";
import {
  type ModelConfig,
  structuredReportTemplate,
  structuredReports,
} from "@/db/schema";
import { sendQstashMessage } from "@/service/qstash";
import { getUserTeamIds } from "@/service/userTeams";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";

const adminPlaygroundRoutes = async (fastify: FastifyInstance) => {
  // 1. GET /members — List org members for user picker
  fastify.get("/members", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "List org members for playground user picker",
      tags: ["Admin"],
      querystring: Type.Object({
        orgId: Type.String(),
      }),
    },
    handler: async (request, reply) => {
      const { orgId } = request.query as { orgId: string };

      const members = await getDb()
        .select({
          id: organizationMembers.id,
          name: organizationMembers.name,
          email: organizationMembers.email,
          teams: organizationMembers.teams,
        })
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, orgId));

      // Deduplicate by member id (there can be multiple rows per member)
      const uniqueMembers = new Map<
        string,
        { id: string; name: string | null; email: string | null; teams: unknown }
      >();
      for (const m of members) {
        if (!uniqueMembers.has(m.id)) {
          uniqueMembers.set(m.id, m);
        }
      }

      return reply.send({ items: Array.from(uniqueMembers.values()) });
    },
  });

  // 2. POST /chat — Streaming agent chat proxy
  fastify.post("/chat", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Admin playground streaming agent chat",
      tags: ["Admin"],
      body: Type.Object({
        messages: Type.Array(Type.Any()),
        userId: Type.String(),
        orgId: Type.String(),
        sessionId: Type.Optional(Type.String()),
        model: Type.Optional(Type.String()),
        webSearch: Type.Optional(Type.Boolean()),
      }),
    },
    handler: async (request, reply) => {
      const { messages, userId, orgId, sessionId: requestSessionId, model, webSearch } =
        request.body as {
          messages: FinAgentUIMessage[];
          userId: string;
          orgId: string;
          sessionId?: string;
          model?: string;
          webSearch?: boolean;
        };

      // Resolve or create session
      const sessionId = requestSessionId || uuidv4();
      const { session } = await getSessionWithMessages(sessionId, userId);

      // Resolve team IDs for the impersonated user
      const teamIds = await getUserTeamIds(userId, orgId);

      const modelEnum = (model as MODELS) || MODELS.GROK_CODE_FAST_1;

      const saveMessage = async (message: FinAgentUIMessage) => {
        const sqlMsg: SQLMessage = {
          id: message.id || "",
          role: message.role,
          parts: [],
          metadata: message.data,
          createdAt: new Date(),
          updatedAt: null,
          sessionId: sessionId,
          userId: userId,
        } as unknown as SQLMessage;
        await syncMessages([sqlMsg]);
      };

      const result = await finAgent({
        context: { userId, sessionId, orgId, teamIds },
        messages,
        saveMessage,
        model: modelEnum,
        webSearch: webSearch ?? false,
      });

      return reply.send(
        result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages: finishedMessages }) => {
            const lastMessage = finishedMessages[finishedMessages.length - 1];
            if (lastMessage) {
              await saveMessage(lastMessage);
            }
          },
        }),
      );
    },
  });

  // 3. GET /templates — List report templates
  fastify.get("/templates", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "List all structured report templates",
      tags: ["Admin"],
    },
    handler: async (_request, reply) => {
      const templates = await getDb()
        .select()
        .from(structuredReportTemplate)
        .orderBy(desc(structuredReportTemplate.id));
      return reply.send({ items: templates });
    },
  });

  // 4. POST /reports — Create structured report
  fastify.post("/reports", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Create a structured report for a specified user",
      tags: ["Admin"],
      body: Type.Object({
        userId: Type.String(),
        templateId: Type.String(),
        topic: Type.String(),
        referencePeriod: Type.Optional(Type.String()),
        modelConfig: Type.Optional(Type.Any()),
      }),
    },
    handler: async (request, reply) => {
      const body = request.body as {
        userId: string;
        templateId: string;
        topic: string;
        referencePeriod?: string;
        modelConfig?: ModelConfig;
      };

      const [report] = await getDb()
        .insert(structuredReports)
        .values({
          userId: body.userId,
          templateId: body.templateId,
          topic: body.topic,
          referencePeriod: body.referencePeriod ?? null,
          status: "pending",
          modelConfig: body.modelConfig ?? null,
        })
        .returning();

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

      return reply.send(report);
    },
  });

  // 5. GET /reports — List reports for a user
  fastify.get("/reports", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "List structured reports for a specified user",
      tags: ["Admin"],
      querystring: Type.Object({
        userId: Type.String(),
      }),
    },
    handler: async (request, reply) => {
      const { userId } = request.query as { userId: string };

      const reports = await getDb()
        .select({
          id: structuredReports.id,
          userId: structuredReports.userId,
          templateId: structuredReports.templateId,
          topic: structuredReports.topic,
          referencePeriod: structuredReports.referencePeriod,
          status: structuredReports.status,
          metadata: structuredReports.metadata,
          templateName: structuredReportTemplate.title,
        })
        .from(structuredReports)
        .where(eq(structuredReports.userId, userId))
        .leftJoin(
          structuredReportTemplate,
          eq(structuredReports.templateId, structuredReportTemplate.id),
        )
        .orderBy(desc(structuredReports.id));

      return reply.send({ items: reports });
    },
  });

  // 6. GET /reports/:id — Get report detail
  fastify.get("/reports/:id", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Get structured report detail by ID",
      tags: ["Admin"],
      params: Type.Object({ id: Type.String() }),
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const report = await getDb().query.structuredReports.findFirst({
        where: eq(structuredReports.id, id),
      });
      if (!report) return reply.code(404).send({ error: "Not found" });
      return reply.send(report);
    },
  });
};

export default adminPlaygroundRoutes;
