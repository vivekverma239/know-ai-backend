CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."web_search_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "account" (
	"userId" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"provider" varchar(255) NOT NULL,
	"providerAccountId" varchar(255) NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" varchar(255),
	"scope" varchar(255),
	"id_token" text,
	"session_state" varchar(255),
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "chat_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"userId" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documentId" uuid NOT NULL,
	"chapterId" uuid,
	"startPage" integer,
	"endPage" integer,
	"content" text NOT NULL,
	"embedding" vector(768),
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "llm_tip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"category" varchar(255),
	"embedding" vector(768),
	"createdById" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" varchar(255) NOT NULL,
	"sessionId" uuid NOT NULL,
	"parts" jsonb,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" varchar(255) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "text_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"createdById" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256),
	"embedding" vector(768),
	"metadata" jsonb,
	"createdById" varchar(255) NOT NULL,
	"processing_status" "processing_status" DEFAULT 'pending',
	"parsingMetadata" jsonb,
	"tokenUsage" jsonb,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "file_chapter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"startPage" integer NOT NULL,
	"endPage" integer NOT NULL,
	"embedding" vector(768),
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_cluster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"startPage" integer NOT NULL,
	"endPage" integer NOT NULL,
	"pageSummaries" jsonb,
	"summary" text NOT NULL,
	"embedding" vector(768),
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "file_heirarchial_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"level" integer NOT NULL,
	"startPage" integer NOT NULL,
	"endPage" integer NOT NULL,
	"embedding" vector(768),
	"metadata" jsonb,
	"children" jsonb,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "file_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"pageNumber" integer NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"chapterId" uuid,
	"startPage" integer NOT NULL,
	"endPage" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"subsections" jsonb,
	"embedding" vector(768),
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"email" varchar(255) NOT NULL,
	"emailVerified" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"image" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "web_search_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" varchar(255) NOT NULL,
	"query" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sources" json,
	"helpfulText" text,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_tip" ADD CONSTRAINT "llm_tip_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_sessionId_chat_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."chat_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_note" ADD CONSTRAINT "text_note_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_file" ADD CONSTRAINT "user_file_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chapter" ADD CONSTRAINT "file_chapter_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_cluster" ADD CONSTRAINT "file_cluster_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_heirarchial_index" ADD CONSTRAINT "file_heirarchial_index_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_page" ADD CONSTRAINT "file_page_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_section" ADD CONSTRAINT "file_section_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_section" ADD CONSTRAINT "file_section_chapterId_file_chapter_id_fk" FOREIGN KEY ("chapterId") REFERENCES "public"."file_chapter"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_search_task" ADD CONSTRAINT "web_search_task_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "chunk_document_id_idx" ON "chunk" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "chunk_chapter_id_idx" ON "chunk" USING btree ("chapterId");--> statement-breakpoint
CREATE INDEX "chunk_document_id_start_page_end_page_idx" ON "chunk" USING btree ("documentId","startPage","endPage");--> statement-breakpoint
CREATE INDEX "t_user_id_idx" ON "session" USING btree ("userId");