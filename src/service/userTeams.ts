import { getDb } from "@/db";
import { accounts, accountsMemberships } from "@/db/external_schema";
import { and, eq } from "drizzle-orm";

/**
 * Look up all team IDs (account IDs) a user belongs to within a given organization.
 * Joins `ext_accounts_memberships` with `ext_accounts` to find accounts
 * in the specified org that the user is a member of.
 */
export const getUserTeamIds = async (userId: string, orgId: string): Promise<string[]> => {
  try {
    const rows = await getDb()
      .select({ accountId: accountsMemberships.accountId })
      .from(accountsMemberships)
      .innerJoin(accounts, eq(accountsMemberships.accountId, accounts.id))
      .where(
        and(
          eq(accountsMemberships.userId, userId),
          eq(accounts.organizationId, orgId),
        ),
      );

    return rows.map((row) => row.accountId);
  } catch {
    // External tables may not exist in all environments (e.g., test)
    // Return empty team list rather than blocking auth
    return [];
  }
};
