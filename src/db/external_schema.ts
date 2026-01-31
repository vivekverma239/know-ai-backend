import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgTableCreator,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * External schema for ingesting events from the core app DB.
 * Following the structure provided in the conversation.
 */
export const createExternalTable = pgTableCreator((name) => `ext_${name}`);

// Types
export type HighlightType = "highlight" | "screenshot";
export type EntityType = "corporate" | "country" | "commodity" | "macro" | "sector";
export type TrendDirection = "bullish" | "bearish";
export type AssetType = "equity" | "credit" | "fx" | "rates" | "commodity";

// Core Tables
export const highlights = createExternalTable("highlights", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  content: text("content"),
  documentId: bigint("document_id", { mode: "number" }),
  authorId: uuid("author_id"),
  teamId: uuid("team_id"),
  meta: jsonb("meta"),
  type: text("type").$type<HighlightType>().default("highlight"),
  imageUrl: text("image_url"),
  imageId: uuid("image_id"),
  translationId: bigint("translation_id", { mode: "number" }),

  // AI Indexing
  contentEmbedding: vector("content_embedding", { dimensions: 768 }),
  aiDescription: text("ai_description"), // For screenshots
  aiSummary: text("ai_summary"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
}));

export const entities = createExternalTable("entities", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull().unique(),
  uniqueId: text("unique_id").unique(),
  type: text("type").$type<EntityType>(),
  description: text("description"),

  // AI Indexing
  descriptionEmbedding: vector("description_embedding", { dimensions: 768 }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
}));

export const tags = createExternalTable("tags", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  authorId: uuid("author_id"),
  teamId: uuid("team_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}));

// Derived Content Tables
export const trends = createExternalTable("trends", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  documentId: bigint("document_id", { mode: "number" }),
  highlightId: bigint("highlight_id", { mode: "number" }).references(() => highlights.id, {
    onDelete: "cascade",
  }),
  entityId: bigint("entity_id", { mode: "number" }).references(() => entities.id),
  trend: text("trend").$type<TrendDirection>(),
  comment: text("comment"),
  authorId: uuid("author_id"),
  teamId: uuid("team_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
}));

export const trendsAssets = createExternalTable("trends_assets", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  trendId: bigint("trend_id", { mode: "number" }).references(() => trends.id, {
    onDelete: "cascade",
  }),
  highlightId: bigint("highlight_id", { mode: "number" }).references(() => highlights.id),
  documentId: bigint("document_id", { mode: "number" }),
  entityId: bigint("entity_id", { mode: "number" }).references(() => entities.id),
  trend: text("trend").$type<TrendDirection>(),
  type: text("type").$type<AssetType>(),
  value: text("value"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}));

export const scenarios = createExternalTable("scenarios", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  highlightId: bigint("highlight_id", { mode: "number" }).references(() => highlights.id, {
    onDelete: "cascade",
  }),
  documentId: bigint("document_id", { mode: "number" }),
  description: text("description"),
  implication: text("implication"),
  title: text("title"),
  tentative: boolean("tentative").default(false),
  withTime: boolean("with_time").default(false),
  probability: numeric("probability"),
  fromDate: timestamp("from_date", { withTimezone: true }),
  toDate: timestamp("to_date", { withTimezone: true }),
  authorId: uuid("author_id"),
  teamId: uuid("team_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
}));

export const scenarioRemarks = createExternalTable("scenario_remarks", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  scenarioId: bigint("scenario_id", { mode: "number" }).references(() => scenarios.id, {
    onDelete: "cascade",
  }),
  documentId: bigint("document_id", { mode: "number" }),
  entityId: bigint("entity_id", { mode: "number" }).references(() => entities.id),
  variation: numeric("variation"),
  asset: text("asset").$type<AssetType>(),
  authorId: uuid("author_id"),
  teamId: uuid("team_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}));

export const calendarEvents = createExternalTable("calendar_events", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  highlightId: bigint("highlight_id", { mode: "number" }).references(() => highlights.id, {
    onDelete: "cascade",
  }),
  documentId: bigint("document_id", { mode: "number" }),
  description: text("description"),
  implication: text("implication"),
  tentative: boolean("tentative").default(false),
  withTime: boolean("with_time").default(false),
  fromDate: timestamp("from_date", { withTimezone: true }),
  toDate: timestamp("to_date", { withTimezone: true }),
  authorId: uuid("author_id"),
  teamId: uuid("team_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}));

export const followups = createExternalTable("followups", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  highlightId: bigint("highlight_id", { mode: "number" }).references(() => highlights.id, {
    onDelete: "cascade",
  }),
  documentId: bigint("document_id", { mode: "number" }),
  targetId: uuid("target_id"),
  question: text("question"),
  authorId: uuid("author_id"),
  teamId: uuid("team_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}));

export const highlightComments = createExternalTable("highlight_comments", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  highlightId: bigint("highlight_id", { mode: "number" }).references(() => highlights.id, {
    onDelete: "cascade",
  }),
  replyTo: bigint("reply_to", { mode: "number" }),
  message: text("message"),
  trend: text("trend").$type<TrendDirection>(),
  authorId: uuid("author_id"),
  teamId: uuid("team_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}));

// Join Tables
export const highlightsEntitiesRel = createExternalTable(
  "highlights_entities_rel",
  (t) => ({
    highlightId: bigint("highlight_id", { mode: "number" }).references(() => highlights.id, {
      onDelete: "cascade",
    }),
    entityId: bigint("entity_id", { mode: "number" }).references(() => entities.id, {
      onDelete: "cascade",
    }),
    userDefined: boolean("user_defined").default(false),
  }),
  (t) => ({
    pk: index("highlights_entities_rel_pk").on(t.highlightId, t.entityId),
  }),
);

export const highlightsTagsRel = createExternalTable(
  "highlights_tags_rel",
  (t) => ({
    highlightId: bigint("highlight_id", { mode: "number" }).references(() => highlights.id, {
      onDelete: "cascade",
    }),
    tagId: bigint("tag_id", { mode: "number" }).references(() => tags.id, { onDelete: "cascade" }),
  }),
  (t) => ({
    pk: index("highlights_tags_rel_pk").on(t.highlightId, t.tagId),
  }),
);

export const calendarEventsEntitiesRel = createExternalTable(
  "calendar_events_entities_rel",
  (t) => ({
    calendarEventId: bigint("calendar_event_id", { mode: "number" }).references(
      () => calendarEvents.id,
      { onDelete: "cascade" },
    ),
    entityId: bigint("entity_id", { mode: "number" }).references(() => entities.id, {
      onDelete: "cascade",
    }),
  }),
  (t) => ({
    pk: index("calendar_events_entities_rel_pk").on(t.calendarEventId, t.entityId),
  }),
);

export const documents = createExternalTable("documents", (t) => ({
  id: bigint("id", { mode: "number" }).primaryKey(),
  type: text("type"),
  title: text("title"),
  teamId: uuid("team_id"),
  assetId: uuid("asset_id"),
  assetUrl: text("asset_url"),
  authorId: uuid("author_id"),
  documentUrl: text("document_url"),
  thumbnailUrl: text("thumbnail_url"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
}));

export const organizations = createExternalTable("organizations", (t) => ({
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  mnemonicId: text("mnemonic_id"),
  ownerId: uuid("owner_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
}));

export const accounts = createExternalTable("accounts", (t) => ({
  id: uuid("id").primaryKey(),
  primaryOwnerUserId: uuid("primary_owner_user_id"),
  name: text("name"),
  slug: text("slug"),
  email: text("email"),
  isPersonalAccount: boolean("is_personal_account").default(false),
  pictureUrl: text("picture_url"),
  publicData: jsonb("public_data"),
  organizationId: uuid("organization_id").references(() => organizations.id),
  accountType: text("account_type"),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
}));
