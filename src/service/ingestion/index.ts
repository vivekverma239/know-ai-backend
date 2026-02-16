import { getDb } from "@/db";
import {
  accounts,
  calendarEvents,
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
} from "@/db/external_schema";
import { logError, logger } from "@/utils/logger";
import { traceManager } from "@/utils/tracing";
import { and, eq } from "drizzle-orm";
import { deleteUserFileForDocument, ensureUserFileForDocument } from "./documentIngestion";
import { ensureHighlightEmbedding } from "./highlightIngestion";

export type IngestionPayload = {
  id?: number | string;
  data: Record<string, unknown>;
  type: string;
  action: "insert" | "update" | "delete";
  timestamp: string;
};

// Define a type for our tables to avoid using any
type ExternalTable =
  | typeof highlights
  | typeof entities
  | typeof tags
  | typeof trends
  | typeof trendsAssets
  | typeof scenarios
  | typeof scenarioRemarks
  | typeof calendarEvents
  | typeof followups
  | typeof highlightComments
  | typeof highlightsEntitiesRel
  | typeof highlightsTagsRel
  | typeof documents
  | typeof organizations
  | typeof accounts;

const tableMap: Record<string, ExternalTable> = {
  highlight: highlights,
  entity: entities,
  tag: tags,
  trend: trends,
  trend_asset: trendsAssets,
  scenario: scenarios,
  scenario_remark: scenarioRemarks,
  calendar_event: calendarEvents,
  followup: followups,
  highlight_comment: highlightComments,
  highlight_entity: highlightsEntitiesRel,
  highlight_tag: highlightsTagsRel,
  document: documents,
  organization: organizations,
  account: accounts,
};

const TIMESTAMP_KEYS = new Set(["createdAt", "updatedAt", "fromDate", "toDate"]);

const coerceTimestampValue = (value: unknown, key: string): Date | null | undefined => {
  if (value === undefined) return undefined;

  if (value === null) {
    // Let DB defaults handle createdAt/updatedAt if null comes in from webhook.
    if (key === "createdAt" || key === "updatedAt") return undefined;
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  logger.warn("Ingestion event: invalid timestamp value skipped.", {
    key,
    value,
  });
  return undefined;
};

// Helper to map payload keys to camelCase keys used in Drizzle
const mapToInternal = (data: Record<string, unknown>): Record<string, unknown> => {
  const mapped: Record<string, unknown> = {};
  for (const key in data) {
    const internalKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
    const value = data[key];

    if (TIMESTAMP_KEYS.has(internalKey)) {
      const coerced = coerceTimestampValue(value, internalKey);
      if (coerced !== undefined) {
        mapped[internalKey] = coerced;
      }
      continue;
    }

    mapped[internalKey] = value;
  }
  return mapped;
};

export const processIngestionEvent = async (event: IngestionPayload) => {
  return traceManager.withSpan(
    "ingestion:processEvent",
    async (span) => {
      const { type, action, data } = event;
      const table = tableMap[type];

      if (!table) {
        logger.warn("Unknown event type received", { type, action });
        return;
      }

      try {
        const internalData = mapToInternal(data);

        if (action === "insert" || action === "update") {
          logger.info(`Processing ${action} for ${type}`, { id: data.id });

          if (type === "highlight_entity") {
            const relTable = highlightsEntitiesRel;
            const values = internalData as typeof relTable.$inferInsert;
            await getDb()
              .insert(relTable)
              .values(values)
              .onConflictDoUpdate({
                target: [relTable.highlightId, relTable.entityId],
                set: values,
              });
          } else if (type === "highlight_tag") {
            const relTable = highlightsTagsRel;
            const values = internalData as typeof relTable.$inferInsert;
            await getDb()
              .insert(relTable)
              .values(values)
              .onConflictDoUpdate({
                target: [relTable.highlightId, relTable.tagId],
                set: values,
              });
          } else {
            switch (type) {
              case "highlight":
                await getDb()
                  .insert(highlights)
                  .values(internalData as typeof highlights.$inferInsert)
                  .onConflictDoUpdate({
                    target: highlights.id,
                    set: internalData as typeof highlights.$inferInsert,
                  });
                await ensureHighlightEmbedding(
                  {
                    id: (data.id as string | number | undefined) ?? undefined,
                    imageUrl: internalData.imageUrl as string | undefined,
                  },
                  action,
                );
                break;
              case "entity":
                await getDb()
                  .insert(entities)
                  .values(internalData as typeof entities.$inferInsert)
                  .onConflictDoUpdate({
                    target: entities.id,
                    set: internalData as typeof entities.$inferInsert,
                  });
                break;
              case "tag":
                await getDb()
                  .insert(tags)
                  .values(internalData as typeof tags.$inferInsert)
                  .onConflictDoUpdate({
                    target: tags.id,
                    set: internalData as typeof tags.$inferInsert,
                  });
                break;
              case "trend":
                await getDb()
                  .insert(trends)
                  .values(internalData as typeof trends.$inferInsert)
                  .onConflictDoUpdate({
                    target: trends.id,
                    set: internalData as typeof trends.$inferInsert,
                  });
                break;
              case "trend_asset":
                await getDb()
                  .insert(trendsAssets)
                  .values(internalData as typeof trendsAssets.$inferInsert)
                  .onConflictDoUpdate({
                    target: trendsAssets.id,
                    set: internalData as typeof trendsAssets.$inferInsert,
                  });
                break;
              case "scenario":
                await getDb()
                  .insert(scenarios)
                  .values(internalData as typeof scenarios.$inferInsert)
                  .onConflictDoUpdate({
                    target: scenarios.id,
                    set: internalData as typeof scenarios.$inferInsert,
                  });
                break;
              case "scenario_remark":
                await getDb()
                  .insert(scenarioRemarks)
                  .values(internalData as typeof scenarioRemarks.$inferInsert)
                  .onConflictDoUpdate({
                    target: scenarioRemarks.id,
                    set: internalData as typeof scenarioRemarks.$inferInsert,
                  });
                break;
              case "calendar_event":
                await getDb()
                  .insert(calendarEvents)
                  .values(internalData as typeof calendarEvents.$inferInsert)
                  .onConflictDoUpdate({
                    target: calendarEvents.id,
                    set: internalData as typeof calendarEvents.$inferInsert,
                  });
                break;
              case "followup":
                await getDb()
                  .insert(followups)
                  .values(internalData as typeof followups.$inferInsert)
                  .onConflictDoUpdate({
                    target: followups.id,
                    set: internalData as typeof followups.$inferInsert,
                  });
                break;
              case "highlight_comment":
                await getDb()
                  .insert(highlightComments)
                  .values(internalData as typeof highlightComments.$inferInsert)
                  .onConflictDoUpdate({
                    target: highlightComments.id,
                    set: internalData as typeof highlightComments.$inferInsert,
                  });
                break;
              case "document":
                await getDb()
                  .insert(documents)
                  .values(internalData as typeof documents.$inferInsert)
                  .onConflictDoUpdate({
                    target: documents.id,
                    set: internalData as typeof documents.$inferInsert,
                  });
                await ensureUserFileForDocument(
                  {
                    id: (data.id as string | number | undefined) ?? undefined,
                    type: internalData.type as "webpage" | "pdf" | undefined,
                    title: internalData.title as string | undefined,
                    teamId: internalData.teamId as string | undefined,
                    authorId: internalData.authorId as string | undefined,
                    assetUrl: internalData.assetUrl as string | undefined,
                  },
                  action,
                );
                break;
              case "organization":
                await getDb()
                  .insert(organizations)
                  .values(internalData as typeof organizations.$inferInsert)
                  .onConflictDoUpdate({
                    target: organizations.id,
                    set: internalData as typeof organizations.$inferInsert,
                  });
                break;
              case "account":
                await getDb()
                  .insert(accounts)
                  .values(internalData as typeof accounts.$inferInsert)
                  .onConflictDoUpdate({
                    target: accounts.id,
                    set: internalData as typeof accounts.$inferInsert,
                  });
                break;
            }
          }
        } else if (action === "delete") {
          logger.info(`Processing delete for ${type}`, { id: data.id });

          if (type === "highlight_entity") {
            const relTable = highlightsEntitiesRel;
            await getDb()
              .delete(relTable)
              .where(
                and(
                  eq(relTable.highlightId, internalData.highlightId as number),
                  eq(relTable.entityId, internalData.entityId as number),
                ),
              );
          } else if (type === "highlight_tag") {
            const relTable = highlightsTagsRel;
            await getDb()
              .delete(relTable)
              .where(
                and(
                  eq(relTable.highlightId, internalData.highlightId as number),
                  eq(relTable.tagId, internalData.tagId as number),
                ),
              );
          } else {
            const id = data.id as number;
            switch (type) {
              case "highlight":
                await getDb().delete(highlights).where(eq(highlights.id, id));
                break;
              case "entity":
                await getDb().delete(entities).where(eq(entities.id, id));
                break;
              case "tag":
                await getDb().delete(tags).where(eq(tags.id, id));
                break;
              case "trend":
                await getDb().delete(trends).where(eq(trends.id, id));
                break;
              case "trend_asset":
                await getDb().delete(trendsAssets).where(eq(trendsAssets.id, id));
                break;
              case "scenario":
                await getDb().delete(scenarios).where(eq(scenarios.id, id));
                break;
              case "scenario_remark":
                await getDb().delete(scenarioRemarks).where(eq(scenarioRemarks.id, id));
                break;
              case "calendar_event":
                await getDb().delete(calendarEvents).where(eq(calendarEvents.id, id));
                break;
              case "followup":
                await getDb().delete(followups).where(eq(followups.id, id));
                break;
              case "highlight_comment":
                await getDb().delete(highlightComments).where(eq(highlightComments.id, id));
                break;
              case "document":
                await getDb().delete(documents).where(eq(documents.id, id));
                await deleteUserFileForDocument({
                  id: (data.id as string | number | undefined) ?? undefined,
                });
                break;
            }
          }
        }
      } catch (error) {
        logError(error, {
          operation: "processIngestionEvent",
          type,
          action,
          eventData: data,
          spanId: span.id,
        });
        throw error;
      }
    },
    { type: event.type, action: event.action },
  );
};
