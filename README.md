# Knowsis AI Backend

This backend provides chat streaming, document upload/processing, and web search tasking APIs used by the Knowsis frontend. It is built with Fastify + TypeScript and exposes OpenAPI docs.

- Base URL (local): `http://localhost:3000`
- OpenAPI docs (local): `http://localhost:3000/docs`
- API prefix: `/api/v1`

## Quick Start

1. Install pnpm if needed.
2. Install deps:
   ```bash
   pnpm install
   ```
3. Set up environment variables (see .env example below).
4. Build and run in dev:
   ```bash
   pnpm dev
   ```
   Or run compiled server:
   ```bash
   pnpm build && pnpm start
   ```

## Authentication & Required Headers

All non-callback endpoints are protected by a simple bearer token and require user/org headers. The auth middleware validates:

- `Authorization: Bearer <BACKEND_TOKEN>`
- `x-user-id: <string>`
- `x-org-id: <string>`
- Optional: `x-user-email`, `x-user-name`

Set `BACKEND_TOKEN` in the backend environment and supply the same token from the frontend for every request. Callback routes (e.g., QStash, parsing) are verified differently and do NOT need these headers.

Admin endpoints use a separate JWT flow and do not require `x-user-id` / `x-org-id` headers.

## Environment Variables (.env)

Minimal set to run locally:

```env
ENV=dev
PORT=3000
BACKEND_TOKEN=dev_token_here

# Database (Drizzle + Postgres)
DATABASE_URL=postgres://user:pass@localhost:5432/knowsis

# Google Cloud Storage (if using GCS-backed storage)
GCS_PROJECT_ID=your-project
GCS_BUCKET=your-bucket
GOOGLE_APPLICATION_CREDENTIALS=./data/lara-ai-5d6b5-firebase-adminsdk-wt9qe-4fa14262e8.json

# Upstash QStash (for background tasks)
QSTASH_TOKEN=your-qstash-token
QSTASH_CURRENT_SIGNING_KEY=your-current-key
QSTASH_NEXT_SIGNING_KEY=your-next-key

# AI providers (via ai-sdk)
OPENAI_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
PERPLEXITY_API_KEY=...

# Admin dashboard auth
ADMIN_SECRETS_FILE=data/admin-secrets.json
ADMIN_JWT_SECRET=super_long_secret

# Optional admin session TTLs
ADMIN_CHALLENGE_TTL_MINUTES=5
ADMIN_ACCESS_TTL_MINUTES=480
ADMIN_QR_OUTPUT_DIR=data/admin-totp-qr

# Optional (only for running test/adminDashboard.test.ts)
ADMIN_TEST_USER_ID=admin1
ADMIN_TEST_PASSWORD=your-plain-password
ADMIN_TEST_TOTP_SECRET=BASE32SECRET
```

OpenTelemetry logs to Axiom (optional):

```env
ENABLE_OPENTELEMETRY=true
ENABLE_OPENTELEMETRY_LOGS=true
OTEL_SERVICE_NAME=knowsis-ai-backend
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://api.axiom.co/v1/logs
OTEL_EXPORTER_OTLP_LOGS_HEADERS=Authorization=Bearer <AXIOM_TOKEN>,x-axiom-dataset=<AXIOM_DATASET>
```

Generate multi-admin JSON from `userId password` pairs:

```bash
pnpm admin:generate-users-json admin1 "password-1" admin2 "password-2"
```

This prints:
- `ADMIN_SECRETS_FILE` path to set in `.env`
- TOTP secret + `otpauth://` URI for each admin user
- PNG QR code path for each admin user (scan directly in authenticator app)

It also writes `admin-secrets.json` (default: `data/admin-secrets.json`) containing all admin auth secrets.

Tip: The server binds to `localhost` unless `ENV=prod`, then it listens on `0.0.0.0`.

## Endpoints Overview

- Health: `/api/v1/health`
- Chat sessions: `/api/v1/chat-session`
- Chat streaming: `/api/v1/chat`
- Files: `/api/v1/files`
- Web search (agent + tasks): `/api/v1/agent/web-search`
- Admin auth + admin dashboard APIs: `/api/v1/admin/auth`, `/api/v1/admin`
- Callbacks: `/api/v1/web-search-callback`, `/api/v1/callbacks/parsing/:fileId`

Use the live docs at `/docs` for full schemas. Below are concise integration examples.

### Health

GET `/api/v1/health`

```bash
curl -s http://localhost:3000/api/v1/health
```

Response:

```json
{ "status": "ok" }
```

### Chat Sessions

- GET `/:id` — get a session with messages
- POST `/` — create a session
- GET `/` — list sessions with cursor pagination

Headers (all):

- `Authorization: Bearer <BACKEND_TOKEN>`
- `x-user-id`, `x-org-id`

Create session:

```bash
curl -X POST http://localhost:3000/api/v1/chat-session \
  -H "Authorization: Bearer $BACKEND_TOKEN" \
  -H "x-user-id: user_123" -H "x-org-id: org_123" \
  -H "Content-Type: application/json" \
  -d '{"id":"sess_1","title":"My first chat"}'
```

List sessions:

```bash
curl -s "http://localhost:3000/api/v1/chat-session?limit=10" \
  -H "Authorization: Bearer $BACKEND_TOKEN" \
  -H "x-user-id: user_123" -H "x-org-id: org_123"
```

### Chat Streaming (AI SDK compatible)

POST `/api/v1/chat`

Headers:

- `Authorization: Bearer <BACKEND_TOKEN>`
- `x-user-id`, `x-org-id`
- `Content-Type: application/json`

Body:

```json
{
  "messages": [
    {
      "id": "msg_1",
      "role": "user",
      "parts": [{ "type": "text", "text": "Hello" }]
    }
  ],
  "sessionId": "sess_1",
  "deepSearch": "knowledgeBase" // or "agentSearch"
}
```

- When `deepSearch` is `agentSearch`, the deep research tool is enabled and the response streams step updates.
- Response is a stream suitable for AI SDK `toUIMessageStreamResponse` consumption.

### Files API

Base: `/api/v1/files`

Headers:

- `Authorization: Bearer <BACKEND_TOKEN>`
- `x-user-id`, `x-org-id`

Operations:

- `GET /` — list files with meta and optional filters: `page`, `pageSize`, `search`, `status`
- `GET /:id` — file details + signed URL (if available)
- `GET /pages?fileId=...&limit&offset`
- `GET /chapters?fileId=...`
- `GET /sections?fileId=...&limit&offset`
- `GET /hierarchical-index?fileId=...&level&limit&offset`
- `DELETE /:id`
- `POST /upload-url` — returns signed URL for direct PDF upload
- `POST /parse-async` — registers a file and triggers parsing for an existing upload
- `POST /upload` — multipart direct upload + async parsing
- `POST /admin/upload` — multipart upload as org-admin (visible to all users in org)

Example: direct multipart upload

```bash
curl -X POST http://localhost:3000/api/v1/files/upload \
  -H "Authorization: Bearer $BACKEND_TOKEN" \
  -H "x-user-id: user_123" -H "x-org-id: org_123" \
  -F file=@/path/to/document.pdf
```

Example: signed upload URL then trigger parse

```bash
# 1) get upload URL
curl -s -X POST http://localhost:3000/api/v1/files/upload-url \
  -H "Authorization: Bearer $BACKEND_TOKEN" \
  -H "x-user-id: user_123" -H "x-org-id: org_123" \
  -H 'Content-Type: application/json' \
  -d '{"fileId":"doc_123"}'

# 2) PUT your PDF to the signed URL (no auth headers, use the signed URL's method)
# 3) notify backend to parse
curl -X POST http://localhost:3000/api/v1/files/parse-async \
  -H "Authorization: Bearer $BACKEND_TOKEN" \
  -H "x-user-id: user_123" -H "x-org-id: org_123" \
  -H 'Content-Type: application/json' \
  -d '{"fileId":"doc_123"}'
```

### Web Search (Agent + QStash Tasks)

Base: `/api/v1/agent/web-search`

Headers:

- `Authorization: Bearer <BACKEND_TOKEN>`
- `x-user-id`, `x-org-id`

Operations:

- `POST /tasks` — create a background task for `query`; returns the task
- `GET /tasks/:id` — fetch a task by id (must belong to the user)
- `GET /tasks` — list current user's tasks
- `POST /tasks/retry` — retry a failed task
- `POST /doc-agent-search` — legacy: run agent directly (no tasking)

Create task:

```bash
curl -X POST http://localhost:3000/api/v1/agent/web-search/tasks \
  -H "Authorization: Bearer $BACKEND_TOKEN" \
  -H "x-user-id: user_123" -H "x-org-id: org_123" \
  -H "Content-Type: application/json" \
  -d '{"query":"Find recent 10-K highlights","userId":"user_123","orgId":"org_123"}'
```

### Callback Endpoints

- `POST /api/v1/web-search-callback` — Upstash QStash callback (verifies `Upstash-Signature` header). The backend queues, executes, and updates task status accordingly.
- `POST /api/v1/callbacks/parsing/:fileId` — internal parsing callbacks for PDF parsing pipeline.

Frontends typically won't call these directly.

### Admin APIs

Base auth: `/api/v1/admin/auth`

- `POST /login` — body `{ userId, password }` -> returns `challengeToken`
- `POST /verify-totp` — body `{ challengeToken, totpCode }` -> returns `accessToken`
- `GET /me` — validates admin JWT

Base data: `/api/v1/admin` (requires `Authorization: Bearer <admin_access_token>`)

- `GET /orgs`
- `GET /documents`
- `GET /documents/:id`
- `GET /documents/:id/pages`
- `GET /documents/:id/page/:pageNumber`
- `GET /documents/:id/sections`
- `GET /entities`
- `GET /entities/:entityId`

Example admin login flow:

```bash
# 1) password step
curl -X POST http://localhost:3000/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId":"admin1","password":"your-password"}'

# 2) TOTP step
curl -X POST http://localhost:3000/api/v1/admin/auth/verify-totp \
  -H "Content-Type: application/json" \
  -d '{"challengeToken":"<from step 1>","totpCode":"123456"}'
```

Example admin documents call:

```bash
curl -s "http://localhost:3000/api/v1/admin/documents?page=1&pageSize=25" \
  -H "Authorization: Bearer <admin_access_token>"
```

## Frontend Integration Notes

- Always send auth headers `Authorization`, `x-user-id`, `x-org-id`.
- For chat streaming, use `fetch` with `ReadableStream` or your framework's streaming utilities. The response is compatible with AI SDK stream handling.
- Prefer `POST /files/upload-url` + direct PUT to storage for large PDFs; use `POST /files/parse-async` afterwards.
- For organization-wide docs, use `POST /files/admin/upload`.

## Local Development

- Run `pnpm dev` to start Fastify on port 3000.
- Run `pnpm admin:dev` to start the Vite admin dashboard (`admin-dashboard/`) locally.
- Visit `/docs` for auto-generated OpenAPI.
- Tests (examples in `test/`):
  - `pnpm test:doc-parsing`
  - `pnpm test:chat-stream`
  - `pnpm test:admin-dashboard`

## Troubleshooting

- 401/403 errors: confirm `Authorization: Bearer <BACKEND_TOKEN>` and header names are correct.
- 400 missing headers: ensure `x-user-id` and `x-org-id` are set for non-callback endpoints.
- File access: users can access their own files and admin files within the same org.
- QStash tasks not progressing: verify `QSTASH_*` envs and callback URL reachability.
