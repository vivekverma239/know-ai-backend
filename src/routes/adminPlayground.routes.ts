import type { Message as SQLMessage } from "@/@types";
import { type FinAgentUIMessage, finAgent } from "@/agents/finAgent";
import { getDb } from "@/db";
import { accounts, accountsMemberships } from "@/db/external_schema";
import { createSession, getSessionWithMessages, syncMessages } from "@/db/queries/message";
import {
  type ModelConfig,
  structuredReportTemplate,
  structuredReports,
  userFile,
} from "@/db/schema";
import { sendQstashMessage } from "@/service/qstash";
import { getUserTeamIds } from "@/service/userTeams";
import { NotFoundError } from "@/utils/errorHandler";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
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

      // Resolve or create session
      const sessionId = requestSessionId || uuidv4();
      const existing = await getSessionWithMessages(sessionId, userId);
      if (!existing) {
        await createSession(userId, "New Session", sessionId);
      }

      // Resolve team IDs for the impersonated user
      const teamIds = await getUserTeamIds(userId, orgId);

      const saveMessages = async (messagesToSave: FinAgentUIMessage[]) => {
        const sqlMessages: SQLMessage[] = messagesToSave.map((message) => {
          return {
            id: message.id || uuidv4(),
            role: message.role,
            parts: message.parts,
            metadata: message.data,
            createdAt: new Date(),
            updatedAt: null,
            sessionId,
            userId,
          } as unknown as SQLMessage;
        });
        if (sqlMessages.length > 0) {
          await syncMessages(sqlMessages);
        }
      };

      // Persist user input before invoking the agent stream.
      const incomingUserMessages = messages.filter((message) => message.role === "user");
      await saveMessages(incomingUserMessages);

      const result = await finAgent({
        context: { userId, sessionId, orgId, teamIds },
        messages,
        saveMessage: async (message: FinAgentUIMessage) => {
          await saveMessages([message]);
        },
        webSearch: webSearch ?? false,
      });

      return reply.send(
        result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages: finishedMessages }) => {
            try {
              await saveMessages(finishedMessages as FinAgentUIMessage[]);
            } catch (error) {
              logger.error("Failed to persist messages on stream finish", {
                error: error instanceof Error ? error.message : String(error),
                sessionId,
              });
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
      if (!report) throw new NotFoundError("Report not found");
      return reply.send(report);
    },
  });
};

export default adminPlaygroundRoutes;
