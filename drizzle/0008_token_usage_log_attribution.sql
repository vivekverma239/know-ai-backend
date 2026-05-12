ALTER TABLE "token_usage_log" ADD COLUMN "parentOperationId" varchar(255);--> statement-breakpoint
ALTER TABLE "token_usage_log" ADD COLUMN "messageId" varchar(255);--> statement-breakpoint
ALTER TABLE "token_usage_log" ADD COLUMN "actorUserId" varchar(255);--> statement-breakpoint
ALTER TABLE "token_usage_log" ADD COLUMN "source" varchar(32) DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "token_usage_log" ADD COLUMN "cachedInputTokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "token_usage_log" ADD COLUMN "reasoningTokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "token_usage_log_message_id_idx" ON "token_usage_log" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "token_usage_log_actor_user_id_idx" ON "token_usage_log" USING btree ("actorUserId");--> statement-breakpoint
CREATE INDEX "token_usage_log_source_idx" ON "token_usage_log" USING btree ("source");