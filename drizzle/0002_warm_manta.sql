CREATE TABLE "ext_organization_members" (
	"row_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ext_organization_members_row_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" uuid NOT NULL,
	"name" text,
	"email" text,
	"team_type" text,
	"organization_id" uuid,
	"org_owner_id" uuid,
	"teams" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_file" ADD COLUMN "sourceDocumentUrl" text;--> statement-breakpoint
ALTER TABLE "ext_highlights" ADD COLUMN "image_parsed_content" text;--> statement-breakpoint
ALTER TABLE "ext_organization_members" ADD CONSTRAINT "ext_organization_members_organization_id_ext_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."ext_organizations"("id") ON DELETE no action ON UPDATE no action;