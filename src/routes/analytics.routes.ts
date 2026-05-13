import { getDb } from "@/db";
import { tokenUsageLog } from "@/db/schema";
import { logError, logger } from "@/utils/logger";
import { getRequestId } from "@/utils/requestContext";
import { Type } from "@sinclair/typebox";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

/** Reusable source enum for analytics querystrings. Mirrors `CostSource`. */
const SourceFilter = Type.Union([
  Type.Literal("chat"),
  Type.Literal("parse"),
  Type.Literal("report"),
  Type.Literal("tool"),
  Type.Literal("search"),
  Type.Literal("embedding"),
  Type.Literal("other"),
]);

/**
 * Analytics routes for token usage and cost tracking.
 *
 * Mounted under `/api/v1/admin/analytics` and gated by `authenticateAdmin` —
 * these aggregations expose org-wide data that no end-user should query.
 */
const analyticsRoutes = async (fastify: FastifyInstance) => {
  fastify.addHook("onRequest", fastify.authenticateAdmin);

  /**
   * Get token usage summary
   * Returns aggregated token usage and cost data
   */
  fastify.get(
    "/token-usage/summary",
    {
      schema: {
        description: "Get aggregated token usage and cost summary",
        tags: ["Analytics"],
        querystring: Type.Object({
          startDate: Type.Optional(Type.String({ format: "date-time" })),
          endDate: Type.Optional(Type.String({ format: "date-time" })),
          userId: Type.Optional(Type.String()),
          actorUserId: Type.Optional(Type.String()),
          orgId: Type.Optional(Type.String()),
          sessionId: Type.Optional(Type.String()),
          source: Type.Optional(SourceFilter),
        }),
        response: {
          200: Type.Object({
            summary: Type.Array(
              Type.Object({
                model: Type.String(),
                totalTokens: Type.Number(),
                totalCost: Type.Number(),
                requestCount: Type.Number(),
                promptTokens: Type.Number(),
                completionTokens: Type.Number(),
              }),
            ),
            totals: Type.Object({
              totalTokens: Type.Number(),
              totalCost: Type.Number(),
              requestCount: Type.Number(),
            }),
            requestId: Type.String(),
          }),
          500: Type.Object({
            error: Type.String(),
            requestId: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const requestId = getRequestId();

      try {
        const { startDate, endDate, userId, actorUserId, orgId, sessionId, source } =
          request.query as {
            startDate?: string;
            endDate?: string;
            userId?: string;
            actorUserId?: string;
            orgId?: string;
            sessionId?: string;
            source?: string;
          };

        const conditions = [];
        if (startDate) {
          conditions.push(gte(tokenUsageLog.timestamp, new Date(startDate)));
        }
        if (endDate) {
          conditions.push(lte(tokenUsageLog.timestamp, new Date(endDate)));
        }
        if (userId) {
          conditions.push(eq(tokenUsageLog.userId, userId));
        }
        if (actorUserId) {
          conditions.push(eq(tokenUsageLog.actorUserId, actorUserId));
        }
        if (orgId) {
          conditions.push(eq(tokenUsageLog.orgId, orgId));
        }
        if (sessionId) {
          conditions.push(eq(tokenUsageLog.sessionId, sessionId));
        }
        if (source) {
          conditions.push(eq(tokenUsageLog.source, source));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Query aggregated data by model.
        const summary = await getDb()
          .select({
            model: tokenUsageLog.model,
            totalTokens: sql<number>`CAST(SUM(${tokenUsageLog.totalTokens}) AS INTEGER)`,
            promptTokens: sql<number>`CAST(SUM(${tokenUsageLog.promptTokens}) AS INTEGER)`,
            completionTokens: sql<number>`CAST(SUM(${tokenUsageLog.completionTokens}) AS INTEGER)`,
            totalCost: sql<number>`CAST(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)) AS FLOAT)`,
            requestCount: sql<number>`CAST(COUNT(DISTINCT ${tokenUsageLog.requestId}) AS INTEGER)`,
          })
          .from(tokenUsageLog)
          .where(whereClause)
          .groupBy(tokenUsageLog.model);

        // Totals can't be summed across model groups — a request that hit
        // multiple models would be counted once per model. Run a separate
        // aggregation so `requestCount` is the true distinct-request count.
        const totalsRow = await getDb()
          .select({
            totalTokens: sql<number>`CAST(COALESCE(SUM(${tokenUsageLog.totalTokens}), 0) AS INTEGER)`,
            totalCost: sql<number>`CAST(COALESCE(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)), 0) AS FLOAT)`,
            requestCount: sql<number>`CAST(COUNT(DISTINCT ${tokenUsageLog.requestId}) AS INTEGER)`,
          })
          .from(tokenUsageLog)
          .where(whereClause);
        const totals = totalsRow[0] ?? { totalTokens: 0, totalCost: 0, requestCount: 0 };

        logger.info("Token usage summary retrieved", {
          requestId,
          filters: { startDate, endDate, userId, orgId, sessionId, source },
          resultCount: summary.length,
        });

        return reply.send({
          summary,
          totals,
          requestId: requestId ?? "unknown",
        });
      } catch (error) {
        logError(error, {
          requestId,
          operation: "analytics:tokenUsageSummary",
        });

        return reply.code(500).send({
          error: "Failed to retrieve token usage summary",
          requestId: requestId ?? "unknown",
        });
      }
    },
  );

  /**
   * Get token usage by user
   * Returns top users by token consumption
   */
  fastify.get(
    "/token-usage/by-user",
    {
      schema: {
        description: "Get top users by token usage",
        tags: ["Analytics"],
        querystring: Type.Object({
          startDate: Type.Optional(Type.String({ format: "date-time" })),
          endDate: Type.Optional(Type.String({ format: "date-time" })),
          orgId: Type.Optional(Type.String()),
          source: Type.Optional(SourceFilter),
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
        }),
        response: {
          200: Type.Object({
            users: Type.Array(
              Type.Object({
                userId: Type.String(),
                totalTokens: Type.Number(),
                totalCost: Type.Number(),
                requestCount: Type.Number(),
              }),
            ),
            requestId: Type.String(),
          }),
          500: Type.Object({
            error: Type.String(),
            requestId: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const requestId = getRequestId();

      try {
        const {
          startDate,
          endDate,
          orgId,
          source,
          limit = 10,
        } = request.query as {
          startDate?: string;
          endDate?: string;
          orgId?: string;
          source?: string;
          limit?: number;
        };

        const conditions = [isNotNull(tokenUsageLog.userId)];
        if (startDate) {
          conditions.push(gte(tokenUsageLog.timestamp, new Date(startDate)));
        }
        if (endDate) {
          conditions.push(lte(tokenUsageLog.timestamp, new Date(endDate)));
        }
        if (orgId) {
          conditions.push(eq(tokenUsageLog.orgId, orgId));
        }
        if (source) {
          conditions.push(eq(tokenUsageLog.source, source));
        }

        // Query top users. NULL userId rows (background workflows pre-context-fix)
        // are filtered at the SQL layer so LIMIT counts only attributed users.
        const users = await getDb()
          .select({
            userId: sql<string>`${tokenUsageLog.userId}`,
            totalTokens: sql<number>`CAST(SUM(${tokenUsageLog.totalTokens}) AS INTEGER)`,
            totalCost: sql<number>`CAST(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)) AS FLOAT)`,
            requestCount: sql<number>`CAST(COUNT(DISTINCT ${tokenUsageLog.requestId}) AS INTEGER)`,
          })
          .from(tokenUsageLog)
          .where(and(...conditions))
          .groupBy(tokenUsageLog.userId)
          .orderBy(desc(sql`SUM(${tokenUsageLog.totalTokens})`))
          .limit(limit);

        logger.info("Token usage by user retrieved", {
          requestId,
          filters: { startDate, endDate, orgId, source, limit },
          resultCount: users.length,
        });

        return reply.send({
          users,
          requestId: requestId ?? "unknown",
        });
      } catch (error) {
        logError(error, {
          requestId,
          operation: "analytics:tokenUsageByUser",
        });

        return reply.code(500).send({
          error: "Failed to retrieve token usage by user",
          requestId: requestId ?? "unknown",
        });
      }
    },
  );

  /**
   * Get token usage by operation
   * Returns most expensive operations
   */
  fastify.get(
    "/token-usage/by-operation",
    {
      schema: {
        description: "Get operations sorted by token usage",
        tags: ["Analytics"],
        querystring: Type.Object({
          startDate: Type.Optional(Type.String({ format: "date-time" })),
          endDate: Type.Optional(Type.String({ format: "date-time" })),
          userId: Type.Optional(Type.String()),
          source: Type.Optional(SourceFilter),
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
        }),
        response: {
          200: Type.Object({
            operations: Type.Array(
              Type.Object({
                operationName: Type.String(),
                totalTokens: Type.Number(),
                totalCost: Type.Number(),
                callCount: Type.Number(),
                avgTokensPerCall: Type.Number(),
              }),
            ),
            requestId: Type.String(),
          }),
          500: Type.Object({
            error: Type.String(),
            requestId: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const requestId = getRequestId();

      try {
        const {
          startDate,
          endDate,
          userId,
          source,
          limit = 10,
        } = request.query as {
          startDate?: string;
          endDate?: string;
          userId?: string;
          source?: string;
          limit?: number;
        };

        const conditions = [];
        if (startDate) {
          conditions.push(gte(tokenUsageLog.timestamp, new Date(startDate)));
        }
        if (endDate) {
          conditions.push(lte(tokenUsageLog.timestamp, new Date(endDate)));
        }
        if (userId) {
          conditions.push(eq(tokenUsageLog.userId, userId));
        }
        if (source) {
          conditions.push(eq(tokenUsageLog.source, source));
        }

        // Query operations
        const operations = await getDb()
          .select({
            operationName: tokenUsageLog.operationName,
            totalTokens: sql<number>`CAST(SUM(${tokenUsageLog.totalTokens}) AS INTEGER)`,
            totalCost: sql<number>`CAST(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)) AS FLOAT)`,
            callCount: sql<number>`CAST(COUNT(*) AS INTEGER)`,
            avgTokensPerCall: sql<number>`CAST(AVG(${tokenUsageLog.totalTokens}) AS INTEGER)`,
          })
          .from(tokenUsageLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(tokenUsageLog.operationName)
          .orderBy(desc(sql`SUM(${tokenUsageLog.totalTokens})`))
          .limit(limit);

        logger.info("Token usage by operation retrieved", {
          requestId,
          filters: { startDate, endDate, userId, source, limit },
          resultCount: operations.length,
        });

        return reply.send({
          operations,
          requestId: requestId ?? "unknown",
        });
      } catch (error) {
        logError(error, {
          requestId,
          operation: "analytics:tokenUsageByOperation",
        });

        return reply.code(500).send({
          error: "Failed to retrieve token usage by operation",
          requestId: requestId ?? "unknown",
        });
      }
    },
  );

  /**
   * Get token usage per day — for time-series charts.
   */
  fastify.get(
    "/token-usage/by-day",
    {
      schema: {
        description: "Get daily token usage and cost totals",
        tags: ["Analytics"],
        querystring: Type.Object({
          startDate: Type.Optional(Type.String({ format: "date-time" })),
          endDate: Type.Optional(Type.String({ format: "date-time" })),
          userId: Type.Optional(Type.String()),
          orgId: Type.Optional(Type.String()),
          source: Type.Optional(SourceFilter),
        }),
        response: {
          200: Type.Object({
            days: Type.Array(
              Type.Object({
                day: Type.String(),
                totalTokens: Type.Number(),
                totalCost: Type.Number(),
                requestCount: Type.Number(),
              }),
            ),
            requestId: Type.String(),
          }),
          500: Type.Object({ error: Type.String(), requestId: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const requestId = getRequestId();
      try {
        const { startDate, endDate, userId, orgId, source } = request.query as {
          startDate?: string;
          endDate?: string;
          userId?: string;
          orgId?: string;
          source?: string;
        };

        const conditions = [];
        if (startDate) conditions.push(gte(tokenUsageLog.timestamp, new Date(startDate)));
        if (endDate) conditions.push(lte(tokenUsageLog.timestamp, new Date(endDate)));
        if (userId) conditions.push(eq(tokenUsageLog.userId, userId));
        if (orgId) conditions.push(eq(tokenUsageLog.orgId, orgId));
        if (source) conditions.push(eq(tokenUsageLog.source, source));

        const dayExpr = sql<string>`to_char(date_trunc('day', ${tokenUsageLog.timestamp}), 'YYYY-MM-DD')`;
        const rows = await getDb()
          .select({
            day: dayExpr,
            totalTokens: sql<number>`CAST(SUM(${tokenUsageLog.totalTokens}) AS INTEGER)`,
            totalCost: sql<number>`CAST(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)) AS FLOAT)`,
            requestCount: sql<number>`CAST(COUNT(DISTINCT ${tokenUsageLog.requestId}) AS INTEGER)`,
          })
          .from(tokenUsageLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(dayExpr)
          .orderBy(dayExpr);

        return reply.send({ days: rows, requestId: requestId ?? "unknown" });
      } catch (error) {
        logError(error, { requestId, operation: "analytics:tokenUsageByDay" });
        return reply.code(500).send({
          error: "Failed to retrieve daily token usage",
          requestId: requestId ?? "unknown",
        });
      }
    },
  );

  /**
   * Per-user usage detail — totals, by source, by model, by day. Defaults to
   * month-to-date if no window is supplied.
   */
  fastify.get(
    "/token-usage/by-user/:userId",
    {
      schema: {
        description: "Per-user usage detail (defaults to month-to-date)",
        tags: ["Analytics"],
        params: Type.Object({ userId: Type.String() }),
        querystring: Type.Object({
          startDate: Type.Optional(Type.String({ format: "date-time" })),
          endDate: Type.Optional(Type.String({ format: "date-time" })),
          orgId: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            userId: Type.String(),
            windowStart: Type.String(),
            windowEnd: Type.String(),
            totals: Type.Object({
              totalTokens: Type.Number(),
              totalCost: Type.Number(),
              requestCount: Type.Number(),
            }),
            bySource: Type.Array(
              Type.Object({
                source: Type.String(),
                totalTokens: Type.Number(),
                totalCost: Type.Number(),
                requestCount: Type.Number(),
              }),
            ),
            byModel: Type.Array(
              Type.Object({
                model: Type.String(),
                totalTokens: Type.Number(),
                totalCost: Type.Number(),
                requestCount: Type.Number(),
              }),
            ),
            byDay: Type.Array(
              Type.Object({
                day: Type.String(),
                totalTokens: Type.Number(),
                totalCost: Type.Number(),
                requestCount: Type.Number(),
              }),
            ),
            requestId: Type.String(),
          }),
          500: Type.Object({ error: Type.String(), requestId: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const requestId = getRequestId();
      try {
        const { userId } = request.params as { userId: string };
        const { startDate, endDate, orgId } = request.query as {
          startDate?: string;
          endDate?: string;
          orgId?: string;
        };

        const now = new Date();
        const windowStart = startDate
          ? new Date(startDate)
          : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const windowEnd = endDate ? new Date(endDate) : now;

        const where = and(
          eq(tokenUsageLog.userId, userId),
          gte(tokenUsageLog.timestamp, windowStart),
          lte(tokenUsageLog.timestamp, windowEnd),
          ...(orgId ? [eq(tokenUsageLog.orgId, orgId)] : []),
        );

        const dayExpr = sql<string>`to_char(date_trunc('day', ${tokenUsageLog.timestamp}), 'YYYY-MM-DD')`;

        const [totalsRow, bySource, byModel, byDay] = await Promise.all([
          getDb()
            .select({
              totalTokens: sql<number>`CAST(COALESCE(SUM(${tokenUsageLog.totalTokens}), 0) AS INTEGER)`,
              totalCost: sql<number>`CAST(COALESCE(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)), 0) AS FLOAT)`,
              requestCount: sql<number>`CAST(COUNT(DISTINCT ${tokenUsageLog.requestId}) AS INTEGER)`,
            })
            .from(tokenUsageLog)
            .where(where),
          getDb()
            .select({
              source: tokenUsageLog.source,
              totalTokens: sql<number>`CAST(SUM(${tokenUsageLog.totalTokens}) AS INTEGER)`,
              totalCost: sql<number>`CAST(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)) AS FLOAT)`,
              requestCount: sql<number>`CAST(COUNT(DISTINCT ${tokenUsageLog.requestId}) AS INTEGER)`,
            })
            .from(tokenUsageLog)
            .where(where)
            .groupBy(tokenUsageLog.source)
            .orderBy(desc(sql`SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC))`)),
          getDb()
            .select({
              model: tokenUsageLog.model,
              totalTokens: sql<number>`CAST(SUM(${tokenUsageLog.totalTokens}) AS INTEGER)`,
              totalCost: sql<number>`CAST(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)) AS FLOAT)`,
              requestCount: sql<number>`CAST(COUNT(DISTINCT ${tokenUsageLog.requestId}) AS INTEGER)`,
            })
            .from(tokenUsageLog)
            .where(where)
            .groupBy(tokenUsageLog.model)
            .orderBy(desc(sql`SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC))`)),
          getDb()
            .select({
              day: dayExpr,
              totalTokens: sql<number>`CAST(SUM(${tokenUsageLog.totalTokens}) AS INTEGER)`,
              totalCost: sql<number>`CAST(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)) AS FLOAT)`,
              requestCount: sql<number>`CAST(COUNT(DISTINCT ${tokenUsageLog.requestId}) AS INTEGER)`,
            })
            .from(tokenUsageLog)
            .where(where)
            .groupBy(dayExpr)
            .orderBy(dayExpr),
        ]);

        return reply.send({
          userId,
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          totals: totalsRow[0] ?? { totalTokens: 0, totalCost: 0, requestCount: 0 },
          bySource,
          byModel,
          byDay,
          requestId: requestId ?? "unknown",
        });
      } catch (error) {
        logError(error, { requestId, operation: "analytics:tokenUsageByUserDetail" });
        return reply.code(500).send({
          error: "Failed to retrieve per-user usage detail",
          requestId: requestId ?? "unknown",
        });
      }
    },
  );
};

export default analyticsRoutes;
