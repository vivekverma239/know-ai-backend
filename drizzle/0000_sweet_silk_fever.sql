CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."web_search_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');--> statement-breakpoint
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
CREATE TABLE "structured_report_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"taskDescription" text NOT NULL,
	"prompts" jsonb
);
--> statement-breakpoint
CREATE TABLE "structured_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" varchar(255) NOT NULL,
	"templateId" uuid NOT NULL,
	"topic" varchar(255) NOT NULL,
	"referencePeriod" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"stepOutputs" jsonb,
	"finalOutput" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"usage" jsonb,
	"sources" jsonb,
	"modelConfig" jsonb
);
--> statement-breakpoint
CREATE TABLE "text_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"userId" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "token_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requestId" varchar(255) NOT NULL,
	"operationId" varchar(255) NOT NULL,
	"operationName" varchar(255) NOT NULL,
	"userId" varchar(255),
	"sessionId" varchar(255),
	"orgId" varchar(255),
	"model" varchar(255) NOT NULL,
	"promptTokens" integer NOT NULL,
	"completionTokens" integer NOT NULL,
	"totalTokens" integer NOT NULL,
	"costEstimate" numeric(10, 6),
	"timestamp" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256),
	"isAdminFile" boolean DEFAULT false,
	"userId" varchar(255) NOT NULL,
	"orgId" varchar(255) NOT NULL,
	"embedding" vector(768),
	"metadata" jsonb,
	"processing_status" "processing_status" DEFAULT 'pending',
	"parsingMetadata" jsonb,
	"tokenUsage" jsonb,
	"sourceDocumentId" bigint,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone,
	"type" varchar(255) DEFAULT 'pdf' NOT NULL,
	"webArticleMetadata" jsonb,
	"structuredReportId" uuid
);
--> statement-breakpoint
CREATE TABLE "file_chapter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" varchar(255) NOT NULL,
	"orgId" varchar(255) NOT NULL,
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
	"userId" varchar(255) NOT NULL,
	"orgId" varchar(255) NOT NULL,
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
	"userId" varchar(255) NOT NULL,
	"orgId" varchar(255) NOT NULL,
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
	"userId" varchar(255) NOT NULL,
	"orgId" varchar(255) NOT NULL,
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
CREATE TABLE "user_file_to_c_meta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"toc" jsonb,
	"metadata" jsonb,
	"pages" jsonb,
	"tokenUsage" jsonb DEFAULT 'null'::jsonb,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone,
	CONSTRAINT "user_file_to_c_meta_fileId_unique" UNIQUE("fileId")
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
CREATE TABLE "ext_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"primary_owner_user_id" uuid,
	"name" text,
	"slug" text,
	"email" text,
	"is_personal_account" boolean DEFAULT false,
	"picture_url" text,
	"public_data" jsonb,
	"organization_id" uuid,
	"account_type" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ext_calendar_events" (
	"id" bigint PRIMARY KEY NOT NULL,
	"highlight_id" bigint,
	"document_id" bigint,
	"description" text,
	"implication" text,
	"tentative" boolean DEFAULT false,
	"with_time" boolean DEFAULT false,
	"from_date" timestamp with time zone,
	"to_date" timestamp with time zone,
	"author_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_calendar_events_entities_rel" (
	"calendar_event_id" bigint,
	"entity_id" bigint
);
--> statement-breakpoint
CREATE TABLE "ext_documents" (
	"id" bigint PRIMARY KEY NOT NULL,
	"type" text,
	"title" text,
	"team_id" uuid,
	"asset_id" uuid,
	"asset_url" text,
	"author_id" uuid,
	"document_url" text,
	"thumbnail_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ext_entities" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unique_id" text,
	"type" text,
	"description" text,
	"description_embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "ext_entities_name_unique" UNIQUE("name"),
	CONSTRAINT "ext_entities_unique_id_unique" UNIQUE("unique_id")
);
--> statement-breakpoint
CREATE TABLE "ext_followups" (
	"id" bigint PRIMARY KEY NOT NULL,
	"highlight_id" bigint,
	"document_id" bigint,
	"target_id" uuid,
	"question" text,
	"author_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_highlight_comments" (
	"id" bigint PRIMARY KEY NOT NULL,
	"highlight_id" bigint,
	"reply_to" bigint,
	"message" text,
	"trend" text,
	"author_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_highlights" (
	"id" bigint PRIMARY KEY NOT NULL,
	"content" text,
	"document_id" bigint,
	"author_id" uuid,
	"team_id" uuid,
	"meta" jsonb,
	"type" text DEFAULT 'highlight',
	"image_url" text,
	"image_id" uuid,
	"translation_id" bigint,
	"content_embedding" vector(768),
	"ai_description" text,
	"ai_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ext_highlights_entities_rel" (
	"highlight_id" bigint,
	"entity_id" bigint,
	"user_defined" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "ext_highlights_tags_rel" (
	"highlight_id" bigint,
	"tag_id" bigint
);
--> statement-breakpoint
CREATE TABLE "ext_organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mnemonic_id" text,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ext_scenario_remarks" (
	"id" bigint PRIMARY KEY NOT NULL,
	"scenario_id" bigint,
	"document_id" bigint,
	"entity_id" bigint,
	"variation" numeric,
	"asset" text,
	"author_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_scenarios" (
	"id" bigint PRIMARY KEY NOT NULL,
	"highlight_id" bigint,
	"document_id" bigint,
	"description" text,
	"implication" text,
	"title" text,
	"tentative" boolean DEFAULT false,
	"with_time" boolean DEFAULT false,
	"probability" numeric,
	"from_date" timestamp with time zone,
	"to_date" timestamp with time zone,
	"author_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ext_tags" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"author_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ext_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ext_trends" (
	"id" bigint PRIMARY KEY NOT NULL,
	"document_id" bigint,
	"highlight_id" bigint,
	"entity_id" bigint,
	"trend" text,
	"comment" text,
	"author_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ext_trends_assets" (
	"id" bigint PRIMARY KEY NOT NULL,
	"trend_id" bigint,
	"highlight_id" bigint,
	"document_id" bigint,
	"entity_id" bigint,
	"trend" text,
	"type" text,
	"value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_sessionId_chat_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."chat_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structured_report" ADD CONSTRAINT "structured_report_templateId_structured_report_template_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."structured_report_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_file" ADD CONSTRAINT "user_file_structuredReportId_structured_report_id_fk" FOREIGN KEY ("structuredReportId") REFERENCES "public"."structured_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chapter" ADD CONSTRAINT "file_chapter_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_cluster" ADD CONSTRAINT "file_cluster_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_heirarchial_index" ADD CONSTRAINT "file_heirarchial_index_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_page" ADD CONSTRAINT "file_page_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_section" ADD CONSTRAINT "file_section_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_section" ADD CONSTRAINT "file_section_chapterId_file_chapter_id_fk" FOREIGN KEY ("chapterId") REFERENCES "public"."file_chapter"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_file_to_c_meta" ADD CONSTRAINT "user_file_to_c_meta_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_accounts" ADD CONSTRAINT "ext_accounts_organization_id_ext_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."ext_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_calendar_events" ADD CONSTRAINT "ext_calendar_events_highlight_id_ext_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."ext_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_calendar_events_entities_rel" ADD CONSTRAINT "ext_calendar_events_entities_rel_calendar_event_id_ext_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."ext_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_calendar_events_entities_rel" ADD CONSTRAINT "ext_calendar_events_entities_rel_entity_id_ext_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."ext_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_followups" ADD CONSTRAINT "ext_followups_highlight_id_ext_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."ext_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_highlight_comments" ADD CONSTRAINT "ext_highlight_comments_highlight_id_ext_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."ext_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_highlights_entities_rel" ADD CONSTRAINT "ext_highlights_entities_rel_highlight_id_ext_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."ext_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_highlights_entities_rel" ADD CONSTRAINT "ext_highlights_entities_rel_entity_id_ext_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."ext_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_highlights_tags_rel" ADD CONSTRAINT "ext_highlights_tags_rel_highlight_id_ext_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."ext_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_highlights_tags_rel" ADD CONSTRAINT "ext_highlights_tags_rel_tag_id_ext_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."ext_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_scenario_remarks" ADD CONSTRAINT "ext_scenario_remarks_scenario_id_ext_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."ext_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_scenario_remarks" ADD CONSTRAINT "ext_scenario_remarks_entity_id_ext_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."ext_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_scenarios" ADD CONSTRAINT "ext_scenarios_highlight_id_ext_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."ext_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_trends" ADD CONSTRAINT "ext_trends_highlight_id_ext_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."ext_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_trends" ADD CONSTRAINT "ext_trends_entity_id_ext_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."ext_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_trends_assets" ADD CONSTRAINT "ext_trends_assets_trend_id_ext_trends_id_fk" FOREIGN KEY ("trend_id") REFERENCES "public"."ext_trends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_trends_assets" ADD CONSTRAINT "ext_trends_assets_highlight_id_ext_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."ext_highlights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_trends_assets" ADD CONSTRAINT "ext_trends_assets_entity_id_ext_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."ext_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_document_id_idx" ON "chunk" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "chunk_chapter_id_idx" ON "chunk" USING btree ("chapterId");--> statement-breakpoint
CREATE INDEX "chunk_document_id_start_page_end_page_idx" ON "chunk" USING btree ("documentId","startPage","endPage");--> statement-breakpoint
CREATE INDEX "token_usage_log_request_id_idx" ON "token_usage_log" USING btree ("requestId");--> statement-breakpoint
CREATE INDEX "token_usage_log_user_id_idx" ON "token_usage_log" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "token_usage_log_org_id_idx" ON "token_usage_log" USING btree ("orgId");--> statement-breakpoint
CREATE INDEX "token_usage_log_timestamp_idx" ON "token_usage_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "token_usage_log_session_id_idx" ON "token_usage_log" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "token_usage_log_model_idx" ON "token_usage_log" USING btree ("model");--> statement-breakpoint
CREATE INDEX "calendar_events_entities_rel_pk" ON "ext_calendar_events_entities_rel" USING btree ("calendar_event_id","entity_id");--> statement-breakpoint
CREATE INDEX "highlights_entities_rel_pk" ON "ext_highlights_entities_rel" USING btree ("highlight_id","entity_id");--> statement-breakpoint
CREATE INDEX "highlights_tags_rel_pk" ON "ext_highlights_tags_rel" USING btree ("highlight_id","tag_id");