DROP TABLE "llm_tip" CASCADE;--> statement-breakpoint
ALTER TABLE "user_file" ADD COLUMN "userId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "user_file" ADD COLUMN "orgId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "file_chapter" ADD COLUMN "userId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "file_chapter" ADD COLUMN "orgId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "file_cluster" ADD COLUMN "userId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "file_cluster" ADD COLUMN "orgId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "file_heirarchial_index" ADD COLUMN "userId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "file_heirarchial_index" ADD COLUMN "orgId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "file_section" ADD COLUMN "userId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "file_section" ADD COLUMN "orgId" varchar(255) NOT NULL;