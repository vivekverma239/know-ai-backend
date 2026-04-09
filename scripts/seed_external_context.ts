import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";
import {
  accounts,
  accountsMemberships,
  calendarEvents,
  calendarEventsEntitiesRel,
  documents,
  entities,
  followups,
  highlightComments,
  highlights,
  highlightsEntitiesRel,
  highlightsTagsRel,
  organizations,
  scenarioRemarks,
  scenarios,
  tags,
  trends,
  trendsAssets,
} from "../src/db/external_schema";
import { getDb } from "../src/db";

type TableConfig = {
  name: string;
  fileAliases?: string[];
  insert: (rows: Record<string, unknown>[]) => Promise<void>;
  filterRow?: (row: Record<string, unknown>, knownIds: KnownIds) => boolean;
  collectIds?: (row: Record<string, unknown>, knownIds: KnownIds) => void;
};

const DATA_DIR = process.env.DATA_DIR ?? "./data/supabase_export";
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 500);

type KnownIds = {
  scenarios: Set<number>;
};

const knownIds: KnownIds = {
  scenarios: new Set<number>(),
};

const TABLES: TableConfig[] = [
  {
    name: "organizations",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(organizations)
        .values(rows as typeof organizations.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "accounts",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(accounts)
        .values(rows as typeof accounts.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    // Supabase has no accounts_memberships table — membership data lives
    // inside organization_members.teams[]. Flatten each row's teams array.
    name: "organization_members",
    fileAliases: ["organization_members"],
    insert: async (rows) => {
      if (!rows.length) return;
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
      if (!memberships.length) return;
      await getDb()
        .insert(accountsMemberships)
        .values(memberships as typeof accountsMemberships.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "entities",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(entities)
        .values(rows as typeof entities.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "tags",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(tags)
        .values(rows as typeof tags.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "documents",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(documents)
        .values(rows as typeof documents.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "highlights",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(highlights)
        .values(rows as typeof highlights.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "highlight_comments",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(highlightComments)
        .values(rows as typeof highlightComments.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "highlights_entities_rel",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(highlightsEntitiesRel)
        .values(rows as typeof highlightsEntitiesRel.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "highlights_tags_rel",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(highlightsTagsRel)
        .values(rows as typeof highlightsTagsRel.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "trends",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(trends)
        .values(rows as typeof trends.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "trends_assets",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(trendsAssets)
        .values(rows as typeof trendsAssets.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "scenarios",
    fileAliases: ["scenarios", "scenario"],
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(scenarios)
        .values(rows as typeof scenarios.$inferInsert[])
        .onConflictDoNothing();
    },
    collectIds: (row, known) => {
      if (typeof row.id === "number") {
        known.scenarios.add(row.id);
      }
    },
  },
  {
    name: "scenario_remarks",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(scenarioRemarks)
        .values(rows as typeof scenarioRemarks.$inferInsert[])
        .onConflictDoNothing();
    },
    filterRow: (row, known) =>
      typeof row.scenarioId === "number" && known.scenarios.has(row.scenarioId),
  },
  {
    name: "calendar_events",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(calendarEvents)
        .values(rows as typeof calendarEvents.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "calendar_events_entities_rel",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(calendarEventsEntitiesRel)
        .values(rows as typeof calendarEventsEntitiesRel.$inferInsert[])
        .onConflictDoNothing();
    },
  },
  {
    name: "followups",
    insert: async (rows) => {
      if (!rows.length) return;
      await getDb()
        .insert(followups)
        .values(rows as typeof followups.$inferInsert[])
        .onConflictDoNothing();
    },
  },
];

const mapToInternal = (row: Record<string, unknown>) => {
  const mapped: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const internalKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = row[key];
    if (
      typeof value === "string" &&
      (internalKey.endsWith("At") || internalKey.endsWith("Date"))
    ) {
      mapped[internalKey] = new Date(value);
    } else {
      mapped[internalKey] = value;
    }
  }
  if (!("createdAt" in mapped) || mapped.createdAt == null) {
    mapped.createdAt = new Date();
  }
  if (!("updatedAt" in mapped) || mapped.updatedAt == null) {
    mapped.updatedAt = new Date();
  }
  return mapped;
};

const loadFilePath = (config: TableConfig) => {
  const aliases = config.fileAliases ?? [config.name];
  for (const alias of aliases) {
    const candidate = path.join(DATA_DIR, `${alias}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const seedTable = async (config: TableConfig) => {
  const filePath = loadFilePath(config);
  if (!filePath) {
    console.warn(`Missing export file for ${config.name}`);
    return;
  }

  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const batch: Record<string, unknown>[] = [];
  let count = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // psql row_to_json outputs \\" for embedded quotes — strip extra backslash
    const sanitized = trimmed.replace(/\\\\"/g, '\\"');
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(sanitized) as Record<string, unknown>;
    } catch {
      console.warn(`Skipping malformed JSON line in ${config.name}: ${sanitized.slice(0, 100)}...`);
      continue;
    }
    const mapped = mapToInternal(raw);
    if (config.filterRow && !config.filterRow(mapped, knownIds)) {
      continue;
    }
    batch.push(mapped);
    if (config.collectIds) {
      config.collectIds(mapped, knownIds);
    }

    if (batch.length >= BATCH_SIZE) {
      await config.insert(batch);
      count += batch.length;
      batch.length = 0;
    }
  }

  if (batch.length) {
    await config.insert(batch);
    count += batch.length;
  }

  console.log(`Seeded ${config.name}: ${count} rows`);
};

const main = async () => {
  for (const table of TABLES) {
    await seedTable(table);
  }
  console.log("Seeding complete.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
