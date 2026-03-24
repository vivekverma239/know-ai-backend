-- user_file access control (hot path for every file query)
CREATE INDEX IF NOT EXISTS "user_file_user_org_idx" ON "user_file" ("userId", "orgId");
CREATE INDEX IF NOT EXISTS "user_file_status_idx" ON "user_file" ("status");
CREATE INDEX IF NOT EXISTS "user_file_created_at_idx" ON "user_file" ("createdAt" DESC);

-- file_page retrieval
CREATE INDEX IF NOT EXISTS "file_page_file_id_idx" ON "file_page" ("fileId");

-- message retrieval and ordering
CREATE INDEX IF NOT EXISTS "message_session_id_created_at_idx" ON "message" ("sessionId", "createdAt");

-- token_usage_log analytics queries
CREATE INDEX IF NOT EXISTS "token_usage_log_org_timestamp_idx" ON "token_usage_log" ("orgId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "token_usage_log_user_timestamp_idx" ON "token_usage_log" ("userId", "timestamp" DESC);
