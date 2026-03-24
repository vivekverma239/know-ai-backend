import { and, eq, or, type Column, type SQL } from "drizzle-orm";

/**
 * Builds the standard file access-control predicate.
 * Users can access their own files OR admin files from the same org.
 */
export const buildFileAccessFilter = (
  userIdCol: Column,
  orgIdCol: Column,
  isAdminFileCol: Column,
  userId: string,
  orgId: string,
): SQL =>
  or(
    and(eq(userIdCol, userId), eq(orgIdCol, orgId)),
    and(eq(isAdminFileCol, true), eq(orgIdCol, orgId)),
  )!;
