import { and, eq, exists, or, sql, type Column, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts, accountsMemberships } from "@/db/external_schema";
import { userFile } from "@/db/schema";

/**
 * Standard file access-control predicate.
 *
 * A file is visible if EITHER of these holds:
 *
 *   1. The file is an admin / platform-curated file (`isAdminFile = true`).
 *      These are public to every authenticated user across all orgs.
 *
 *   2. The file lives in the requester's org AND the requester actually
 *      belongs to that org. Membership is verified by either:
 *        a. an explicit `ext_accounts_memberships` row mapped to the orgId
 *           — supports both team-account-id and organization-id forms, since
 *           `userFile.orgId` is used loosely to mean either.
 *        b. the user has at least one file with that `orgId` (implicit
 *           membership — mirrors how `/api/v1/admin/playground/members`
 *           derives membership when an `accounts_memberships` row is missing
 *           but the user has uploaded into the org).
 *
 * Either path under (2) is sufficient. Files in an org the requester has
 * neither uploaded into nor is a member of remain hidden, even if the
 * bearer token is valid for `userId`.
 *
 * `userIdCol` is kept in the signature for callers that still pass it (and
 * for future tightening if private-by-user files come back), but the current
 * logic is purely org-scoped + membership-gated.
 */
export const buildFileAccessFilter = (
  _userIdCol: Column,
  orgIdCol: Column,
  isAdminFileCol: Column,
  userId: string,
  orgId: string,
): SQL =>
  or(
    eq(isAdminFileCol, true),
    and(
      eq(orgIdCol, orgId),
      or(
        exists(
          getDb()
            .select({ one: sql`1` })
            .from(accountsMemberships)
            .innerJoin(accounts, eq(accountsMemberships.accountId, accounts.id))
            .where(
              and(
                eq(accountsMemberships.userId, userId),
                or(eq(accounts.id, orgId), eq(accounts.organizationId, orgId)),
              ),
            ),
        ),
        exists(
          getDb()
            .select({ one: sql`1` })
            .from(userFile)
            .where(and(eq(userFile.userId, userId), eq(userFile.orgId, orgId))),
        ),
      ),
    ),
  )!;
