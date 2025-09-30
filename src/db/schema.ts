import type { Subsection } from "@/@types/fileIndex";
import type { PageSummary } from "@/@types/metadata";
import type { TokenUsage } from "@/@types/tokenUsage";
import { relations, sql } from "drizzle-orm";
import { index, pgEnum, pgTableCreator, primaryKey } from "drizzle-orm/pg-core";
// import { type AdapterAccountType } from "next-auth/adapters";
import { v4 as uuidv4 } from "uuid";

type AdapterAccountType = "email" | "oidc" | "oauth" | "webauthn";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `lara-frontend_${name}`);

export const processingStatus = pgEnum("processing_status", [
  "pending",
  "processing",
  "processed",
  "failed",
]);

export const webSearchStatus = pgEnum("web_search_status", [
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

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

export const userFile = createTable("user_file", (d) => ({
  id: d
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: d.varchar({ length: 256 }),
  embedding: d.vector({ dimensions: 768 }),
  metadata: d.jsonb().$type<FileMetadata>(),
  createdById: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
  status: processingStatus("processing_status").default("pending"),
  parsingMetadata: d.jsonb().$type<{
    done: number;
    total: number;
    retry: number;
  }>(),
  tokenUsage: d.jsonb().$type<TokenUsage>(),
  createdAt: d
    .timestamp({ withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const userFilePage = createTable("file_page", (d) => ({
  id: d
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id),
  pageNumber: d.integer().notNull(),
  content: d.text().notNull(),
}));

export const userFileCluster = createTable("file_cluster", (d) => ({
  id: d
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id),
  startPage: d.integer().notNull(),
  endPage: d.integer().notNull(),
  pageSummaries: d.jsonb().$type<PageSummary[]>(),
  summary: d.text().notNull(),
  embedding: d.vector({ dimensions: 768 }),
  metadata: d.jsonb(),
  createdAt: d
    .timestamp({ withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const userFileChapter = createTable("file_chapter", (d) => ({
  id: d
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id),
  title: d.text().notNull(),
  summary: d.text().notNull(),
  startPage: d.integer().notNull(),
  endPage: d.integer().notNull(),
  embedding: d.vector({ dimensions: 768 }),
  createdAt: d
    .timestamp({ withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
}));

export const userFileSection = createTable("file_section", (d) => ({
  id: d
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  fileId: d
    .uuid()
    .notNull()
    .references(() => userFile.id),
  chapterId: d.uuid().references(() => userFileChapter.id),
  startPage: d.integer().notNull(),
  endPage: d.integer().notNull(),
  title: d.text().notNull(),
  summary: d.text().notNull(),
  subsections: d.jsonb().$type<Subsection[]>(),
  embedding: d.vector({ dimensions: 768 }),
  metadata: d.jsonb(),
  createdAt: d
    .timestamp({ withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const userFileHeirarchialIndex = createTable(
  "file_heirarchial_index",
  (d) => ({
    id: d
      .uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    fileId: d
      .uuid()
      .notNull()
      .references(() => userFile.id),
    title: d.text().notNull(),
    summary: d.text().notNull(),
    level: d.integer().notNull(),
    startPage: d.integer().notNull(),
    endPage: d.integer().notNull(),
    embedding: d.vector({ dimensions: 768 }),
    metadata: d.jsonb(),
    children: d.jsonb(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  })
);

export const textNote = createTable("text_note", (d) => ({
  id: d
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  content: d.text().notNull(),
  createdById: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
  createdAt: d
    .timestamp({ withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const llmTip = createTable("llm_tip", (d) => ({
  id: d
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: d.varchar({ length: 255 }).notNull(),
  content: d.text().notNull(),
  category: d.varchar({ length: 255 }),
  embedding: d.vector({ dimensions: 768 }),
  createdById: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
  createdAt: d
    .timestamp({ withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const chunks = createTable(
  "chunk",
  (d) => ({
    id: d
      .uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: d.uuid().notNull(),
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
    index("chunk_document_id_start_page_end_page_idx").on(
      t.documentId,
      t.startPage,
      t.endPage
    ),
  ]
);

export const chatSession = createTable("chat_session", (d) => ({
  id: d
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: d.varchar({ length: 255 }).notNull(),
  userId: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
  createdAt: d
    .timestamp({ withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const messages = createTable("message", (d) => ({
  id: d
    .varchar({ length: 255 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  role: d.varchar({ length: 255 }).notNull(),
  sessionId: d
    .uuid()
    .notNull()
    .references(() => chatSession.id),
  content: d.text().notNull(),
  parts: d.jsonb(),
  metadata: d.jsonb(),
  createdAt: d
    .timestamp({ withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const users = createTable("user", (d) => ({
  id: d
    .varchar({ length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: d.varchar({ length: 255 }),
  email: d.varchar({ length: 255 }).notNull(),
  emailVerified: d
    .timestamp({
      mode: "date",
      withTimezone: true,
    })
    .default(sql`CURRENT_TIMESTAMP`),
  image: d.varchar({ length: 255 }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
}));

export const accounts = createTable(
  "account",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    type: d.varchar({ length: 255 }).$type<AdapterAccountType>().notNull(),
    provider: d.varchar({ length: 255 }).notNull(),
    providerAccountId: d.varchar({ length: 255 }).notNull(),
    refresh_token: d.text(),
    access_token: d.text(),
    expires_at: d.integer(),
    token_type: d.varchar({ length: 255 }),
    scope: d.varchar({ length: 255 }),
    id_token: d.text(),
    session_state: d.varchar({ length: 255 }),
  }),
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("account_user_id_idx").on(t.userId),
  ]
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessions = createTable(
  "session",
  (d) => ({
    sessionToken: d.varchar({ length: 255 }).notNull().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [index("t_user_id_idx").on(t.userId)]
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const verificationTokens = createTable(
  "verification_token",
  (d) => ({
    identifier: d.varchar({ length: 255 }).notNull(),
    token: d.varchar({ length: 255 }).notNull(),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
);

export const webSearchTask = createTable("web_search_task", (d) => ({
  id: d.uuid().primaryKey().defaultRandom(),
  userId: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
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
  createdAt: d
    .timestamp({ mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: d
    .timestamp({ mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: d.timestamp({ mode: "date", withTimezone: true }),
}));

export const webSearchTaskRelations = relations(webSearchTask, ({ one }) => ({
  user: one(users, { fields: [webSearchTask.userId], references: [users.id] }),
}));

export const UserFileChapter = userFileChapter.$inferSelect;
