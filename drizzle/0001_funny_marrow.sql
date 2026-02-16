ALTER TABLE "user_file" ADD COLUMN "status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "user_file" DROP COLUMN "processing_status";--> statement-breakpoint
DROP TYPE "public"."processing_status";--> statement-breakpoint
DROP TYPE "public"."web_search_status";