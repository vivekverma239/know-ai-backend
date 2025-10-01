ALTER TABLE "user_file" DROP CONSTRAINT "user_file_createdById_user_id_fk";
--> statement-breakpoint
ALTER TABLE "user_file" DROP COLUMN "createdById";