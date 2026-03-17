import type { Subsection } from "@/@types/fileIndex";
import type { MessageParts } from "@/@types/message";
import type { PageSummary } from "@/@types/metadata";
import type { TokenUsage } from "@/@types/tokenUsage";
import type { TokenUsage as AsyncTokenUsage } from "@/utils/asyncHook";
import type { LanguageModelUsage } from "ai";

import type { MODELS } from "@/@types/llm";
import type { ChunkPageSummary, DocumentMetadata, Toc } from "@/agents/document/parseToCMeta";
import { sql } from "drizzle-orm";
import { index, pgTableCreator } from "drizzle-orm/pg-core";
// import { type AdapterAccountType } from "next-auth/adapters";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `${name}`);

export type Company = {
  name: string;
  countries: string[];
  industry: string[];
  productsOrServices: string[];
  customers: string[];
  suppliers: string[];
};
export type FileMetadata = {
  title: string;
  shortSummary: string;
  summary: string;
  year: number;
  documentType: string;
  referencePeriod?: string;
  referencePeriodEnd?: string;
  documentPublishedDate?: string;
  industry?: string;
  companies?: Company[];
  // pageSummaries?: PageSummary[];
};

export type Source = {
  id: string;
  url: string;
  title: string;
  summary: string;
  pageNumbers: number[];
};

export type UserFileStatus = "pending" | "in_progress" | "completed" | "failed";

export const userFile = createTable("user_file", (d) => ({
  id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
  name: d.varchar({ length: 256 }),
  /**
   * If true, the file is an admin file. This is a file that is populated by the admin and is visible by all users.
   */
  isAdminFile: d.boolean().default(false),

  userId: d.varchar({ length: 255 }).notNull(), // knowsis in case of admin file
  orgId: d.varchar({ length: 255 }).notNull(), // knows in case of admin file
  embedding: d.vector({ dimensions: 768 }),
  metadata: d.jsonb().$type<FileMetadata>(),
  status: d.varchar({ length: 20 }).$type<UserFileStatus>().default("pending"),
  parsingMetadata: d.jsonb().$type<{
    done: number;
    total: number;
    retry: number;
  }>(),
  tokenUsage: d.jsonb().$type<TokenUsage>(),
  sourceDocumentId: d.bigint({ mode: "number" }),
  sourceDocumentUrl: d.text(),
  createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  type: d
    .varchar({ length: 255 })
    .$type<"pdf" | "structured_report" | "web_article">()
    .notNull()
    .default("pdf"),
  webArticleMetadata: d.jsonb().$type<{
    url: string;
    title: string;
    content: string;
  }>(),
  structuredReportId: d.uuid().references(() => structuredReports.id, { onDelete: "cascade" }),
}));

export const userFilePage = createTable("file_page", (d) => ({
  id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id, { onDelete: "cascade" }),
  pageNumber: d.integer().notNull(),
  content: d.text().notNull(),
}));

export const userFileToCMeta = createTable("user_file_to_c_meta", (d) => ({
  id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id, { onDelete: "cascade" })
    .unique(),
  toc: d.jsonb().$type<Toc>(),
  metadata: d.jsonb().$type<DocumentMetadata>(),
  pages: d.jsonb().$type<ChunkPageSummary[]>(),
  tokenUsage: d.jsonb().$type<AsyncTokenUsage | null>().default(null),
  createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const userFileCluster = createTable("file_cluster", (d) => ({
  id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id, { onDelete: "cascade" }),
  userId: d.varchar({ length: 255 }).notNull(),
  orgId: d.varchar({ length: 255 }).notNull(),
  startPage: d.integer().notNull(),
  endPage: d.integer().notNull(),
  pageSummaries: d.jsonb().$type<PageSummary[]>(),
  summary: d.text().notNull(),
  embedding: d.vector({ dimensions: 768 }),
  metadata: d.jsonb(),
  createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const userFileChapter = createTable("file_chapter", (d) => ({
  id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
  userId: d.varchar({ length: 255 }).notNull(),
  orgId: d.varchar({ length: 255 }).notNull(),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id, { onDelete: "cascade" }),
  title: d.text().notNull(),
  summary: d.text().notNull(),
  startPage: d.integer().notNull(),
  endPage: d.integer().notNull(),
  embedding: d.vector({ dimensions: 768 }),
  createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}));

export const userFileSection = createTable("file_section", (d) => ({
  id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
  userId: d.varchar({ length: 255 }).notNull(),
  orgId: d.varchar({ length: 255 }).notNull(),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id, { onDelete: "cascade" }),
  chapterId: d.uuid().references(() => userFileChapter.id),
  startPage: d.integer().notNull(),
  endPage: d.integer().notNull(),
  title: d.text().notNull(),
  summary: d.text().notNull(),
  subsections: d.jsonb().$type<Subsection[]>(),
  embedding: d.vector({ dimensions: 768 }),
  metadata: d.jsonb(),
  createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const userFileHeirarchialIndex = createTable("file_heirarchial_index", (d) => ({
  id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
  userId: d.varchar({ length: 255 }).notNull(),
  orgId: d.varchar({ length: 255 }).notNull(),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id, { onDelete: "cascade" }),
  title: d.text().notNull(),
  summary: d.text().notNull(),
  level: d.integer().notNull(),
  startPage: d.integer().notNull(),
  endPage: d.integer().notNull(),
  embedding: d.vector({ dimensions: 768 }),
  metadata: d.jsonb(),
  children: d.jsonb(),
  createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const textNote = createTable("text_note", (d) => ({
  id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
  content: d.text().notNull(),
  userId: d.varchar({ length: 255 }).notNull(),
  createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const chunks = createTable(
  "chunk",
  (d) => ({
    id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
    documentId: d.uuid().notNull().references(() => userFile.id, { onDelete: "cascade" }),
    chapterId: d.uuid(),
    startPage: d.integer(),
    endPage: d.integer(),
    content: d.text().notNull(),
    embedding: d.vector({ dimensions: 768 }),
    metadata: d.jsonb(),
  }),
  (t) => [
    index("chunk_document_id_idx").on(t.documentId),
    index("chunk_chapter_id_idx").on(t.chapterId),
    index("chunk_document_id_start_page_end_page_idx").on(t.documentId, t.startPage, t.endPage),
  ],
);

export const chatSession = createTable("chat_session", (d) => ({
  id: d.uuid().primaryKey().default(sql`gen_random_uuid()`),
  title: d.varchar({ length: 255 }).notNull(),
  userId: d.varchar({ length: 255 }).notNull(),
  createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const messages = createTable("message", (d) => ({
  id: d.varchar({ length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  role: d.varchar({ length: 255 }).notNull(),
  sessionId: d
    .uuid()
    .notNull()
    .references(() => chatSession.id),
  parts: d.jsonb().$type<MessageParts>(),
  metadata: d.jsonb(),
  createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const webSearchTask = createTable("web_search_task", (d) => ({
  id: d.uuid().primaryKey().defaultRandom(),
  userId: d.varchar({ length: 255 }).notNull(),
  query: d.text().notNull(),
  status: d
    .varchar({ length: 20 })
    .$type<"pending" | "in_progress" | "completed" | "failed">()
    .notNull()
    .default("pending"),
  sources: d.json().$type<
    {
      url: string;
      title: string;
      type: "pdf" | "website";
      description: string;
    }[]
  >(),
  helpfulText: d.text(),
  error: d.text(),
  createdAt: d.timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: d.timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  completedAt: d.timestamp({ mode: "date", withTimezone: true }),
}));

export const structuredReportTemplate = createTable("structured_report_template", (d) => ({
  id: d.uuid().primaryKey().defaultRandom(),
  userId: d.varchar({ length: 255 }).notNull(), // Assuming direct user ID storage without relation for now, or match existing pattern
  title: d.varchar({ length: 255 }).notNull(),
  taskDescription: d.text().notNull(),
  prompts: d.jsonb().$type<{
    initialResearchPrompt: string;
    subQuestionsIdentificationPrompt: string;
    finalReportPrompt: string;
  }>(),
}));

export type ModelConfig = {
  initialResearch?: MODELS | string;
  subQuestionsIdentification?: MODELS | string;
  subQuestionAnswer?: MODELS | string;
  finalReport?: MODELS | string;
  subQuestionAnswerMethod?: "fileAgent" | "similaritySearch";
};

// Placeholder for StepOutputs until full agent port
export type StepOutputs = Record<string, unknown>;

export const structuredReports = createTable("structured_report", (d) => ({
  id: d.uuid().primaryKey().defaultRandom(),
  userId: d.varchar({ length: 255 }).notNull(),
  templateId: d
    .uuid()
    .notNull()
    .references(() => structuredReportTemplate.id),
  topic: d.varchar({ length: 255 }).notNull(),
  referencePeriod: d.varchar({ length: 255 }),
  status: d
    .varchar({ length: 20 })
    .$type<"pending" | "in_progress" | "completed" | "failed">()
    .notNull()
    .default("pending"),
  stepOutputs: d.jsonb().$type<StepOutputs>(),
  finalOutput: d.text(),
  metadata: d.jsonb().$type<{ title?: string; summary?: string }>().default({}),
  usage: d.jsonb().$type<Record<string, LanguageModelUsage>>(),
  sources: d.jsonb().$type<Source[]>(),
  modelConfig: d.jsonb().$type<ModelConfig>(),
}));

/**
 * Token usage log table for tracking LLM usage and costs
 * This table stores detailed token usage information for analytics and cost tracking
 */
export const tokenUsageLog = createTable(
  "token_usage_log",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    requestId: d.varchar({ length: 255 }).notNull(),
    operationId: d.varchar({ length: 255 }).notNull(),
    operationName: d.varchar({ length: 255 }).notNull(),
    userId: d.varchar({ length: 255 }),
    sessionId: d.varchar({ length: 255 }),
    orgId: d.varchar({ length: 255 }),
    model: d.varchar({ length: 255 }).notNull(),
    promptTokens: d.integer().notNull(),
    completionTokens: d.integer().notNull(),
    totalTokens: d.integer().notNull(),
    costEstimate: d.numeric({ precision: 10, scale: 6 }),
    timestamp: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    metadata: d.jsonb().$type<Record<string, unknown>>(),
    createdAt: d.timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  }),
  (table) => ({
    requestIdIdx: index("token_usage_log_request_id_idx").on(table.requestId),
    userIdIdx: index("token_usage_log_user_id_idx").on(table.userId),
    orgIdIdx: index("token_usage_log_org_id_idx").on(table.orgId),
    timestampIdx: index("token_usage_log_timestamp_idx").on(table.timestamp),
    sessionIdIdx: index("token_usage_log_session_id_idx").on(table.sessionId),
    modelIdx: index("token_usage_log_model_idx").on(table.model),
  }),
);

export const UserFileChapter = userFileChapter.$inferSelect;

export * from "./external_schema";
