import { getDb } from "@/db";
import { tokenUsageLog } from "@/db/schema";
import { logError, logger } from "@/utils/logger";
import { getRequestId } from "@/utils/requestContext";
import { Type } from "@sinclair/typebox";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

/**
 * Analytics routes for token usage and cost tracking
 */
const analyticsRoutes = async (fastify: FastifyInstance) => {
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
          orgId: Type.Optional(Type.String()),
          sessionId: Type.Optional(Type.String()),
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
        const { startDate, endDate, userId, orgId, sessionId } = request.query as {
          startDate?: string;
          endDate?: string;
          userId?: string;
          orgId?: string;
          sessionId?: string;
        };

        // Build WHERE conditions
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
        if (orgId) {
          conditions.push(eq(tokenUsageLog.orgId, orgId));
        }
        if (sessionId) {
          conditions.push(eq(tokenUsageLog.sessionId, sessionId));
        }

        // Query aggregated data by model
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
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(tokenUsageLog.model);

        // Calculate totals
        const totals = summary.reduce(
          (acc, row) => ({
            totalTokens: acc.totalTokens + row.totalTokens,
            totalCost: acc.totalCost + row.totalCost,
            requestCount: acc.requestCount + row.requestCount,
          }),
          { totalTokens: 0, totalCost: 0, requestCount: 0 },
        );

        logger.info("Token usage summary retrieved", {
          requestId,
          filters: { startDate, endDate, userId, orgId, sessionId },
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
          limit = 10,
        } = request.query as {
          startDate?: string;
          endDate?: string;
          orgId?: string;
          limit?: number;
        };

        // Build WHERE conditions
        const conditions = [];
        if (startDate) {
          conditions.push(gte(tokenUsageLog.timestamp, new Date(startDate)));
        }
        if (endDate) {
          conditions.push(lte(tokenUsageLog.timestamp, new Date(endDate)));
        }
        if (orgId) {
          conditions.push(eq(tokenUsageLog.orgId, orgId));
        }

        // Query top users
        const users = await getDb()
          .select({
            userId: tokenUsageLog.userId,
            totalTokens: sql<number>`CAST(SUM(${tokenUsageLog.totalTokens}) AS INTEGER)`,
            totalCost: sql<number>`CAST(SUM(CAST(${tokenUsageLog.costEstimate} AS NUMERIC)) AS FLOAT)`,
            requestCount: sql<number>`CAST(COUNT(DISTINCT ${tokenUsageLog.requestId}) AS INTEGER)`,
          })
          .from(tokenUsageLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(tokenUsageLog.userId)
          .orderBy(desc(sql`SUM(${tokenUsageLog.totalTokens})`))
          .limit(limit);

        logger.info("Token usage by user retrieved", {
          requestId,
          filters: { startDate, endDate, orgId, limit },
          resultCount: users.length,
        });

        return reply.send({
          users: users.filter((u) => u.userId !== null),
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
          limit = 10,
        } = request.query as {
          startDate?: string;
          endDate?: string;
          userId?: string;
          limit?: number;
        };

        // Build WHERE conditions
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
          filters: { startDate, endDate, userId, limit },
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
};

export default analyticsRoutes;
