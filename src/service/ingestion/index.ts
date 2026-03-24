import { getDb } from "@/db";
import {
  accounts,
  accountsMemberships,
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

export class RetryableIngestionError extends Error {
  readonly reasons: string[];

  constructor(message: string, reasons: string[]) {
    super(message);
    this.name = "RetryableIngestionError";
    this.reasons = reasons;
  }
}

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
  | typeof accounts
  | typeof accountsMemberships;

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
  accounts_membership: accountsMemberships,
};

const TIMESTAMP_KEYS = new Set(["createdAt", "updatedAt", "fromDate", "toDate"]);
const INGESTION_DEBUG_ENABLED = ["1", "true", "yes", "on"].includes(
  (process.env.INGESTION_DEBUG ?? "").toLowerCase(),
);

const logIngestionDebug = (message: string, meta: Record<string, unknown> = {}) => {
  if (!INGESTION_DEBUG_ENABLED) return;
  logger.debug(message, meta);
};

const toNumericId = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toUuid = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const highlightExists = async (id: number) => {
  const rows = await getDb().select({ id: highlights.id }).from(highlights).where(eq(highlights.id, id));
  return rows.length > 0;
};

const entityExists = async (id: number) => {
  const rows = await getDb().select({ id: entities.id }).from(entities).where(eq(entities.id, id));
  return rows.length > 0;
};

const tagExists = async (id: number) => {
  const rows = await getDb().select({ id: tags.id }).from(tags).where(eq(tags.id, id));
  return rows.length > 0;
};

const trendExists = async (id: number) => {
  const rows = await getDb().select({ id: trends.id }).from(trends).where(eq(trends.id, id));
  return rows.length > 0;
};

const scenarioExists = async (id: number) => {
  const rows = await getDb().select({ id: scenarios.id }).from(scenarios).where(eq(scenarios.id, id));
  return rows.length > 0;
};

const calendarEventExists = async (id: number) => {
  const rows = await getDb()
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(eq(calendarEvents.id, id));
  return rows.length > 0;
};

const accountExists = async (id: string) => {
  const rows = await getDb()
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, id));
  return rows.length > 0;
};

const organizationExists = async (id: string) => {
  const rows = await getDb()
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, id));
  return rows.length > 0;
};

type ReferenceValidationResult = {
  valid: boolean;
  reasons: string[];
};

const validateNumericReference = async (
  label: string,
  value: unknown,
  exists: (id: number) => Promise<boolean>,
): Promise<string | null> => {
  if (value === null || value === undefined) return null;
  const id = toNumericId(value);
  if (id === null) {
    return `${label} is not a valid numeric id`;
  }
  const found = await exists(id);
  if (!found) {
    return `${label} ${id} does not exist`;
  }
  return null;
};

const validateUuidReference = async (
  label: string,
  value: unknown,
  exists: (id: string) => Promise<boolean>,
): Promise<string | null> => {
  if (value === null || value === undefined) return null;
  const id = toUuid(value);
  if (!id) {
    return `${label} is not a valid uuid`;
  }
  const found = await exists(id);
  if (!found) {
    return `${label} ${id} does not exist`;
  }
  return null;
};

const validateExternalReferences = async (
  type: string,
  internalData: Record<string, unknown>,
): Promise<ReferenceValidationResult> => {
  const reasons: string[] = [];

  const pushIfPresent = (reason: string | null) => {
    if (reason) reasons.push(reason);
  };

  switch (type) {
    case "account":
      pushIfPresent(
        await validateUuidReference(
          "organization_id",
          internalData.organizationId,
          organizationExists,
        ),
      );
      break;
    case "calendar_event":
      pushIfPresent(
        await validateNumericReference("highlight_id", internalData.highlightId, highlightExists),
      );
      break;
    case "followup":
      pushIfPresent(
        await validateNumericReference("highlight_id", internalData.highlightId, highlightExists),
      );
      break;
    case "highlight_comment":
      pushIfPresent(
        await validateNumericReference("highlight_id", internalData.highlightId, highlightExists),
      );
      break;
    case "highlight_entity":
      pushIfPresent(
        await validateNumericReference("highlight_id", internalData.highlightId, highlightExists),
      );
      pushIfPresent(
        await validateNumericReference("entity_id", internalData.entityId, entityExists),
      );
      break;
    case "highlight_tag":
      pushIfPresent(
        await validateNumericReference("highlight_id", internalData.highlightId, highlightExists),
      );
      pushIfPresent(await validateNumericReference("tag_id", internalData.tagId, tagExists));
      break;
    case "scenario":
      pushIfPresent(
        await validateNumericReference("highlight_id", internalData.highlightId, highlightExists),
      );
      break;
    case "scenario_remark":
      pushIfPresent(
        await validateNumericReference("scenario_id", internalData.scenarioId, scenarioExists),
      );
      pushIfPresent(
        await validateNumericReference("entity_id", internalData.entityId, entityExists),
      );
      break;
    case "trend":
      pushIfPresent(
        await validateNumericReference("highlight_id", internalData.highlightId, highlightExists),
      );
      pushIfPresent(
        await validateNumericReference("entity_id", internalData.entityId, entityExists),
      );
      break;
    case "trend_asset":
      pushIfPresent(await validateNumericReference("trend_id", internalData.trendId, trendExists));
      pushIfPresent(
        await validateNumericReference("highlight_id", internalData.highlightId, highlightExists),
      );
      pushIfPresent(
        await validateNumericReference("entity_id", internalData.entityId, entityExists),
      );
      break;
    case "accounts_membership":
      pushIfPresent(
        await validateUuidReference(
          "account_id",
          internalData.accountId,
          accountExists,
        ),
      );
      break;
    case "calendar_event_entity":
      pushIfPresent(
        await validateNumericReference(
          "calendar_event_id",
          internalData.calendarEventId,
          calendarEventExists,
        ),
      );
      pushIfPresent(
        await validateNumericReference("entity_id", internalData.entityId, entityExists),
      );
      break;
    default:
      break;
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
};

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
      const startedAt = Date.now();
      const { type, action, data } = event;
      const eventMeta = {
        type,
        action,
        eventId: event.id ?? null,
        recordId: data.id ?? null,
      };

      logIngestionDebug("Ingestion event processing started", {
        ...eventMeta,
        timestamp: event.timestamp,
        payloadKeys: Object.keys(data),
      });

      const table = tableMap[type];

      if (!table) {
        logger.warn("Unknown event type received", { type, action });
        logIngestionDebug("Ingestion event ignored due to unknown type", eventMeta);
        return;
      }

      try {
        const internalData = mapToInternal(data);
        logIngestionDebug("Ingestion payload mapped to internal keys", {
          ...eventMeta,
          internalKeys: Object.keys(internalData),
        });

        if (action === "insert" || action === "update") {
          const validation = await validateExternalReferences(type, internalData);
          logIngestionDebug("Ingestion reference validation completed", {
            ...eventMeta,
            isValid: validation.valid,
            reasons: validation.reasons,
          });
          if (!validation.valid) {
            logger.warn("Ingestion event failed reference validation; marking retryable", {
              type,
              action,
              id: data.id,
              reasons: validation.reasons,
            });
            throw new RetryableIngestionError(
              "Missing required referenced records; retry when dependencies are ingested",
              validation.reasons,
            );
          }

          logger.info(`Processing ${action} for ${type}`, { id: data.id });
          logIngestionDebug("Executing ingestion mutation", eventMeta);

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
              case "accounts_membership":
                await getDb()
                  .insert(accountsMemberships)
                  .values(internalData as typeof accountsMemberships.$inferInsert)
                  .onConflictDoUpdate({
                    target: [accountsMemberships.userId, accountsMemberships.accountId],
                    set: internalData as typeof accountsMemberships.$inferInsert,
                  });
                break;
            }
          }
        } else if (action === "delete") {
          logger.info(`Processing delete for ${type}`, { id: data.id });
          logIngestionDebug("Executing ingestion delete", eventMeta);

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
                  teamId: (internalData.teamId as string | undefined) ?? undefined,
                });
                break;
              case "accounts_membership": {
                const delUserId = internalData.userId as string;
                const delAccountId = internalData.accountId as string;
                if (delUserId && delAccountId) {
                  await getDb()
                    .delete(accountsMemberships)
                    .where(
                      and(
                        eq(accountsMemberships.userId, delUserId),
                        eq(accountsMemberships.accountId, delAccountId),
                      ),
                    );
                }
                break;
              }
            }
          }
        }

        logIngestionDebug("Ingestion event processing completed", {
          ...eventMeta,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        logError(error, {
          operation: "processIngestionEvent",
          type,
          action,
          eventData: data,
          spanId: span.id,
        });
        logIngestionDebug("Ingestion event processing failed", {
          ...eventMeta,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    { type: event.type, action: event.action },
  );
};
