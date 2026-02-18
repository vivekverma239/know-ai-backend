import { getDb } from "@/db";
import { organizationMembers } from "@/db/external_schema";
import { and, eq } from "drizzle-orm";

/**
 * Look up all team IDs a user belongs to within a given organization.
 * Queries `ext_organization_members` and extracts team IDs from the JSONB `teams` column.
 */
export const getUserTeamIds = async (userId: string, orgId: string): Promise<string[]> => {
  const rows = await getDb()
    .select({ teams: organizationMembers.teams })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, userId), eq(organizationMembers.organizationId, orgId)));

  const teamIdSet = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row.teams)) {
      for (const team of row.teams) {
        if (team.id) {
          teamIdSet.add(team.id);
        }
      }
    }
  }

  return Array.from(teamIdSet);
};
