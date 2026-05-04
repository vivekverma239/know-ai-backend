import type { Message as SQLMessage } from "@/@types";
import { buildFinAgentStream, type FinAgentUIMessage, finAgent } from "@/agents/finAgent";
import { getDb } from "@/db";
import { accounts, accountsMemberships } from "@/db/external_schema";
import { createSession, getSession, getSessionWithMessages, syncMessages } from "@/db/queries/message";
import {
  type ModelConfig,
  structuredReportTemplate,
  structuredReports,
  userFile,
} from "@/db/schema";
import { runChatStream } from "@/routes/chatStream.routes";
import { sendQstashMessage } from "@/service/qstash";
import { getUserTeamIds } from "@/service/userTeams";
import { AuthorizationError, NotFoundError } from "@/utils/errorHandler";
import type { KnowsisUIMessage } from "@/utils/uiMessageBuilder";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import { createUIMessageStreamResponse } from "ai";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";

const isUuidLike = (value: string) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
};

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
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "list_members",
        ip: request.ip,
      });

      const { orgId } = request.query as { orgId: string };

      // Org scope in admin UI is based on userFile.orgId (team account id), so
      // derive users from userFile first and enrich with team memberships when available.
      const userMap = new Map<
        string,
        { id: string; name: string | null; teams: { id: string; name: string | null }[] }
      >();

      const usersFromFiles = await getDb()
        .select({
          userId: userFile.userId,
        })
        .from(userFile)
        .where(eq(userFile.orgId, orgId))
        .groupBy(userFile.userId);

      for (const row of usersFromFiles) {
        userMap.set(row.userId, { id: row.userId, name: null, teams: [] });
      }

      const allMemberships = await getDb()
        .select({
          userId: accountsMemberships.userId,
          teamId: accountsMemberships.accountId,
          teamName: accounts.name,
        })
        .from(accountsMemberships)
        .innerJoin(accounts, eq(accountsMemberships.accountId, accounts.id))
        // orgId from admin scope can be either:
        // - a team account id (accounts.id), or
        // - an organization id (accounts.organizationId)
        .where(or(eq(accounts.id, orgId), eq(accounts.organizationId, orgId)));

      for (const m of allMemberships) {
        const existingUser = userMap.get(m.userId);
        if (existingUser) {
          existingUser.teams.push({ id: m.teamId, name: m.teamName });
          continue;
        }
        userMap.set(m.userId, {
          id: m.userId,
          name: null,
          teams: [{ id: m.teamId, name: m.teamName }],
        });
      }

      const uuidUserIds = Array.from(userMap.keys()).filter(isUuidLike);
      if (uuidUserIds.length > 0) {
        const userProfiles = await getDb()
          .select({
            id: accounts.id,
            primaryOwnerUserId: accounts.primaryOwnerUserId,
            name: accounts.name,
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.isPersonalAccount, true),
              or(
                inArray(accounts.id, uuidUserIds),
                inArray(accounts.primaryOwnerUserId, uuidUserIds),
              ),
            ),
          );

        for (const profile of userProfiles) {
          const directMatch = userMap.get(profile.id);
          if (directMatch && !directMatch.name) {
            directMatch.name = profile.name ?? null;
          }

          const ownerUserId = profile.primaryOwnerUserId;
          if (ownerUserId) {
            const ownerMatch = userMap.get(ownerUserId);
            if (ownerMatch && !ownerMatch.name) {
              ownerMatch.name = profile.name ?? null;
            }
          }
        }
      }

      return reply.send({
        items: Array.from(userMap.values()).sort((a, b) =>
          (a.name ?? a.id).localeCompare(b.name ?? b.id),
        ),
      });
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
        webSearch: Type.Optional(Type.Boolean()),
      }),
    },
    handler: async (request, reply) => {
      const {
        messages,
        userId,
        orgId,
        sessionId: requestSessionId,
        webSearch,
      } = request.body as {
        messages: FinAgentUIMessage[];
        userId: string;
        orgId: string;
        sessionId?: string;
        webSearch?: boolean;
      };

      logger.warn("Admin action", {
        adminUserId: request.admin?.userId,
        action: "impersonation_chat",
        impersonatedUserId: userId,
        orgId,
        ip: request.ip,
      });

      // Resolve or create session
      const sessionId = requestSessionId || uuidv4();
      const existing = await getSessionWithMessages(sessionId, userId);
      if (!existing) {
        await createSession(userId, "New Session", sessionId);
      }

      // Resolve team IDs for the impersonated user
      const teamIds = await getUserTeamIds(userId, orgId);

      const saveSqlMessage = async (message: KnowsisUIMessage | FinAgentUIMessage) => {
        const row: SQLMessage = {
          id: message.id || uuidv4(),
          role: message.role,
          parts: message.parts,
          metadata:
            (message as KnowsisUIMessage).metadata ??
            (message as FinAgentUIMessage).data ??
            null,
          createdAt: new Date(),
          updatedAt: null,
          sessionId,
          userId,
        } as unknown as SQLMessage;
        await syncMessages([row]);
      };

      // Persist user input before invoking the agent stream.
      for (const message of messages.filter((m) => m.role === "user")) {
        await saveSqlMessage(message);
      }

      const stream = await buildFinAgentStream({
        messages: messages as unknown as KnowsisUIMessage[],
        context: { userId, sessionId, orgId, teamIds },
        // Admin playground defaults web search + bulk indexing on so the
        // FinAgent has access to webDocSearchTool / bulkFileIndexingTool /
        // webSearchTool / webPageScrapeTool out of the box.
        webSearch: webSearch ?? true,
        logger,
        persistAssistant: async (snapshot) => {
          await saveSqlMessage(snapshot);
        },
      });

      return reply.send(createUIMessageStreamResponse({ stream }));
    },
  });

  // 2b. POST /chat-stream — Admin proxy for /api/v1/chat (KB + agentSearch).
  //     Uses admin JWT auth, impersonates {userId, orgId} from the body, and
  //     auto-creates the session if missing. Delegates to the same
  //     runChatStream helper used by /api/v1/chat.
  fastify.post("/chat-stream", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Admin playground proxy for /api/v1/chat (knowledgeBase + agentSearch modes)",
      tags: ["Admin"],
      body: Type.Object({
        messages: Type.Array(Type.Any()),
        userId: Type.String(),
        orgId: Type.String(),
        sessionId: Type.Optional(Type.String()),
        deepSearch: Type.String(),
      }),
    },
    handler: async (request, reply) => {
      const {
        messages,
        userId,
        orgId,
        sessionId: requestSessionId,
        deepSearch,
      } = request.body as {
        messages: KnowsisUIMessage[];
        userId: string;
        orgId: string;
        sessionId?: string;
        deepSearch: string;
      };

      logger.warn("Admin action", {
        adminUserId: request.admin?.userId,
        action: "impersonation_chat_stream",
        impersonatedUserId: userId,
        orgId,
        deepSearch,
        ip: request.ip,
      });

      // Resolve or create session — mirrors the pattern used by /chat above.
      const sessionId = requestSessionId || uuidv4();
      const existing = await getSession(sessionId);
      if (existing && existing.userId !== userId) {
        throw new AuthorizationError("Session belongs to a different user");
      }
      if (!existing) {
        await createSession(userId, "New Session", sessionId);
      }

      const response = await runChatStream({
        userId,
        orgId,
        sessionId,
        messages,
        deepSearch,
      });
      return reply.send(response);
    },
  });

  // 2c. POST /files/lookup — Batch lookup file metadata for citation chips
  // The model emits `[file_<uuid>]` citations inside chat text; the admin
  // dashboard's chip popovers fetch title + summary by id via this endpoint.
  fastify.post("/files/lookup", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Batch lookup file metadata by id for citation chips",
      tags: ["Admin"],
      body: Type.Object({
        ids: Type.Array(Type.String(), { maxItems: 50 }),
      }),
    },
    handler: async (request, reply) => {
      const { ids } = request.body as { ids: string[] };

      // Filter to UUIDs only — the model can hallucinate non-uuid ids.
      const validIds = ids.filter(isUuidLike);
      if (validIds.length === 0) {
        return reply.send({ items: {} });
      }

      const rows = await getDb()
        .select({
          id: userFile.id,
          name: userFile.name,
          metadata: userFile.metadata,
          type: userFile.type,
          webArticleMetadata: userFile.webArticleMetadata,
          createdAt: userFile.createdAt,
        })
        .from(userFile)
        .where(inArray(userFile.id, validIds));

      const items: Record<
        string,
        {
          id: string;
          title: string;
          summary: string;
          documentType?: string;
          year?: number;
          url?: string;
        }
      > = {};
      for (const r of rows) {
        items[r.id] = {
          id: r.id,
          title: r.metadata?.title || r.name || "Untitled",
          summary: r.metadata?.shortSummary || r.metadata?.summary || "",
          documentType: r.metadata?.documentType,
          year: r.metadata?.year,
          url: r.webArticleMetadata?.url,
        };
      }

      return reply.send({ items });
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

      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "create_report",
        impersonatedUserId: body.userId,
        ip: request.ip,
      });

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
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "list_reports",
        ip: request.ip,
      });

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

      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "view_report",
        resourceId: id,
        ip: request.ip,
      });

      const report = await getDb().query.structuredReports.findFirst({
        where: eq(structuredReports.id, id),
      });
      if (!report) throw new NotFoundError("Report not found");
      return reply.send(report);
    },
  });
};

export default adminPlaygroundRoutes;
