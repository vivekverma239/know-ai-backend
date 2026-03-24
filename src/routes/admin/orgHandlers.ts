import { getDb } from "@/db";
import { accounts, organizations } from "@/db/external_schema";
import { userFile } from "@/db/schema";
import { AdminOrgListResponseSchema } from "@/schemas/admin.schema";
import { logger } from "@/utils/logger";
import { desc, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { isUuidLike } from "./utils";

export const registerOrgHandlers = async (fastify: FastifyInstance) => {
  fastify.get("/orgs", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "List organizations with document counts",
      tags: ["Admin"],
      response: {
        200: AdminOrgListResponseSchema,
      },
    },
    handler: async (request, reply) => {
      logger.info("Admin action", {
        adminUserId: request.admin?.userId,
        action: "list_orgs",
        ip: request.ip,
      });

      const orgRows = await getDb()
        .select({
          orgId: userFile.orgId,
          documentCount: sql<number>`CAST(COUNT(*) AS INTEGER)`,
        })
        .from(userFile)
        .groupBy(userFile.orgId)
        .orderBy(desc(sql`COUNT(*)`));

      const orgIds = orgRows.map((row) => row.orgId);
      const uuidOrgIds = orgIds.filter((orgId) => isUuidLike(orgId));

      // userFile.orgId is actually a teamId from the external system.
      // Look up names from both organizations and accounts (which stores team accounts).
      const [orgNames, accountNames] = uuidOrgIds.length
        ? await Promise.all([
            getDb()
              .select({ id: organizations.id, name: organizations.name })
              .from(organizations)
              .where(inArray(organizations.id, uuidOrgIds)),
            getDb()
              .select({ id: accounts.id, name: accounts.name })
              .from(accounts)
              .where(inArray(accounts.id, uuidOrgIds)),
          ])
        : [[], []];

      const orgNameMap = new Map<string, string>();
      for (const org of orgNames) {
        if (org.name) orgNameMap.set(org.id, org.name);
      }
      // Account names (team accounts) take priority if both exist
      for (const acc of accountNames) {
        if (acc.name) orgNameMap.set(acc.id, acc.name);
      }

      return reply.send({
        items: orgRows.map((row) => ({
          orgId: row.orgId,
          name: orgNameMap.get(row.orgId) ?? null,
          documentCount: row.documentCount ?? 0,
        })),
      });
    },
  });
};
