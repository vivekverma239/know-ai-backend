CREATE TABLE "ext_accounts_memberships" (
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"account_role" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ext_organization_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ext_organization_members" CASCADE;--> statement-breakpoint
ALTER TABLE "file_chapter" DROP CONSTRAINT "file_chapter_fileId_user_file_id_fk";
--> statement-breakpoint
ALTER TABLE "file_cluster" DROP CONSTRAINT "file_cluster_fileId_user_file_id_fk";
--> statement-breakpoint
ALTER TABLE "file_heirarchial_index" DROP CONSTRAINT "file_heirarchial_index_fileId_user_file_id_fk";
--> statement-breakpoint
ALTER TABLE "file_page" DROP CONSTRAINT "file_page_fileId_user_file_id_fk";
--> statement-breakpoint
ALTER TABLE "file_section" DROP CONSTRAINT "file_section_fileId_user_file_id_fk";
--> statement-breakpoint
ALTER TABLE "user_file_to_c_meta" DROP CONSTRAINT "user_file_to_c_meta_fileId_user_file_id_fk";
--> statement-breakpoint
ALTER TABLE "structured_report" ADD COLUMN "preflightResult" jsonb;--> statement-breakpoint
ALTER TABLE "structured_report" ADD COLUMN "selectedRecommendations" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_memberships_pk" ON "ext_accounts_memberships" USING btree ("user_id","account_id");--> statement-breakpoint
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_documentId_user_file_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."user_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chapter" ADD CONSTRAINT "file_chapter_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_cluster" ADD CONSTRAINT "file_cluster_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_heirarchial_index" ADD CONSTRAINT "file_heirarchial_index_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_page" ADD CONSTRAINT "file_page_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_section" ADD CONSTRAINT "file_section_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_file_to_c_meta" ADD CONSTRAINT "user_file_to_c_meta_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."user_file"("id") ON DELETE cascade ON UPDATE no action;