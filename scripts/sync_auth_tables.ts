/**
 * Sync auth-related tables from Supabase into the local ext_ tables.
 *
 * Tables synced:
 *   - organizations       → ext_organizations
 *   - accounts            → ext_accounts
 *   - organization_members (teams[]) → ext_accounts_memberships
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx scripts/sync_auth_tables.ts
 *
 * Optional env vars:
 *   DATABASE_URL   – target Postgres (defaults to .env value)
 *   PAGE_SIZE      – rows per Supabase REST page (default 1000)
 *   TABLES         – comma-separated subset, e.g. "accounts,accounts_memberships"
 */
import "dotenv/config";
import { getDb } from "../src/db";
import {
  accounts,
  accountsMemberships,
  organizations,
} from "../src/db/external_schema";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 1000);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

// Map snake_case keys → camelCase to match Drizzle column names
const toCamelCase = (data: Record<string, unknown>): Record<string, unknown> => {
  const mapped: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = data[key];
    if (
      typeof value === "string" &&
      (camelKey.endsWith("At") || camelKey.endsWith("Date"))
    ) {
      mapped[camelKey] = new Date(value);
    } else {
      mapped[camelKey] = value;
    }
  }
  if (!mapped.createdAt) mapped.createdAt = new Date();
  return mapped;
};

// Paginated fetch from Supabase REST API
const fetchAllRows = async (table: string): Promise<Record<string, unknown>[]> => {
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set("select", "*");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(PAGE_SIZE));

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "count=exact",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${table}: ${response.status} ${response.statusText}`);
    }

    const rows = (await response.json()) as Record<string, unknown>[];
    if (!rows.length) break;

    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
};

// Table sync configs — order matters (organizations first, then dependents)
type SyncConfig = {
  name: string;
  sync: (rows: Record<string, unknown>[]) => Promise<void>;
};

const BATCH_SIZE = 500;

const batchInsert = async (
  rows: Record<string, unknown>[],
  insertBatch: (batch: Record<string, unknown>[]) => Promise<void>,
) => {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await insertBatch(batch);
  }
};

const AUTH_TABLES: SyncConfig[] = [
  {
    name: "organizations",
    sync: async (rows) => {
      const mapped = rows.map(toCamelCase);
      await batchInsert(mapped, async (batch) => {
        await getDb()
          .insert(organizations)
          .values(batch as typeof organizations.$inferInsert[])
          .onConflictDoUpdate({
            target: organizations.id,
            set: {
              name: organizations.name,
              mnemonicId: organizations.mnemonicId,
              ownerId: organizations.ownerId,
              updatedAt: new Date(),
            },
          });
      });
    },
  },
  {
    name: "accounts",
    sync: async (rows) => {
      const mapped = rows.map(toCamelCase);
      await batchInsert(mapped, async (batch) => {
        await getDb()
          .insert(accounts)
          .values(batch as typeof accounts.$inferInsert[])
          .onConflictDoUpdate({
            target: accounts.id,
            set: {
              primaryOwnerUserId: accounts.primaryOwnerUserId,
              name: accounts.name,
              slug: accounts.slug,
              email: accounts.email,
              isPersonalAccount: accounts.isPersonalAccount,
              pictureUrl: accounts.pictureUrl,
              publicData: accounts.publicData,
              organizationId: accounts.organizationId,
              accountType: accounts.accountType,
              createdBy: accounts.createdBy,
              updatedBy: accounts.updatedBy,
              updatedAt: new Date(),
            },
          });
      });
    },
  },
  {
    // Supabase has no accounts_memberships table — membership data lives
    // inside organization_members.teams[]. We fetch organization_members
    // and flatten each teams entry into an ext_accounts_memberships row.
    name: "organization_members",
    sync: async (rows) => {
      const memberships: Record<string, unknown>[] = [];
      for (const row of rows) {
        const userId = row.id as string;
        const teams = (row.teams ?? []) as { id: string; name: string; team_type: string }[];
        for (const team of teams) {
          memberships.push({
            userId,
            accountId: team.id,
            accountRole: team.team_type ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
      console.log(`  Expanded ${rows.length} members into ${memberships.length} memberships`);
      await batchInsert(memberships, async (batch) => {
        await getDb()
          .insert(accountsMemberships)
          .values(batch as typeof accountsMemberships.$inferInsert[])
          .onConflictDoUpdate({
            target: [accountsMemberships.userId, accountsMemberships.accountId],
            set: {
              accountRole: accountsMemberships.accountRole,
              updatedAt: new Date(),
            },
          });
      });
    },
  },
];

const main = async () => {
  const filterEnv = process.env.TABLES;
  const tableFilter = filterEnv
    ? new Set(filterEnv.split(",").map((t) => t.trim()))
    : null;

  const tablesToSync = tableFilter
    ? AUTH_TABLES.filter((t) => tableFilter.has(t.name))
    : AUTH_TABLES;

  if (!tablesToSync.length) {
    console.error("No matching tables to sync.");
    process.exit(1);
  }

  console.log(`Syncing ${tablesToSync.length} auth tables from Supabase...\n`);

  for (const config of tablesToSync) {
    console.log(`Fetching ${config.name}...`);
    const rows = await fetchAllRows(config.name);
    console.log(`  Fetched ${rows.length} rows. Upserting...`);
    await config.sync(rows);
    console.log(`  Done: ${config.name} (${rows.length} rows)\n`);
  }

  console.log("Auth tables sync complete.");
  process.exit(0);
};

main().catch((error) => {
  console.error("Sync failed:", error);
  process.exit(1);
});
