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
CREATE TABLE "user_file_to_c_meta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"toc" jsonb,
	"metadata" jsonb,
	"pages" jsonb,
	"tokenUsage" jsonb,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone,
	CONSTRAINT "user_file_to_c_meta_fileId_unique" UNIQUE("fileId")
);
--> statement-breakpoint
ALTER TABLE "account" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification_token" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "account" CASCADE;--> statement-breakpoint
DROP TABLE "session" CASCADE;--> statement-breakpoint
DROP TABLE "user" CASCADE;--> statement-breakpoint
DROP TABLE "verification_token" CASCADE;--> statement-breakpoint
ALTER TABLE "chat_session" DROP CONSTRAINT "chat_session_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "text_note" DROP CONSTRAINT "text_note_createdById_user_id_fk";
--> statement-breakpoint
ALTER TABLE "web_search_task" DROP CONSTRAINT "web_search_task_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "text_note" ADD COLUMN "userId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "user_file" ADD COLUMN "isAdminFile" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_file" ADD COLUMN "type" varchar(255) DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_file" ADD COLUMN "webArticleMetadata" jsonb;--> statement-breakpoint
ALTER TABLE "user_file" ADD COLUMN "structuredReportId" uuid;--> statement-breakpoint
ALTER TABLE "structured_report" ADD CONSTRAINT "structured_report_templateId_structured_report_template_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."structured_report_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_file_to_c_meta" ADD CONSTRAINT "user_file_to_c_meta_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "token_usage_log_request_id_idx" ON "token_usage_log" USING btree ("requestId");--> statement-breakpoint
CREATE INDEX "token_usage_log_user_id_idx" ON "token_usage_log" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "token_usage_log_org_id_idx" ON "token_usage_log" USING btree ("orgId");--> statement-breakpoint
CREATE INDEX "token_usage_log_timestamp_idx" ON "token_usage_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "token_usage_log_session_id_idx" ON "token_usage_log" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "token_usage_log_model_idx" ON "token_usage_log" USING btree ("model");--> statement-breakpoint
ALTER TABLE "user_file" ADD CONSTRAINT "user_file_structuredReportId_structured_report_id_fk" FOREIGN KEY ("structuredReportId") REFERENCES "public"."structured_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_note" DROP COLUMN "createdById";