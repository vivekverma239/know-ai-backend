# Features

Complete catalog of every feature in the Knowsis AI Backend, organized by domain. Each feature includes its endpoints, implementation details, and an analysis of current state with improvement suggestions.

---

## Table of Contents

1. [Document Management](#1-document-management)
2. [Chat & Streaming](#2-chat--streaming)
3. [Financial Research Agent (FinAgent)](#3-financial-research-agent-finagent)
4. [Web Search & Document Discovery](#4-web-search--document-discovery)
5. [Structured Reports](#5-structured-reports)
6. [Deep Research](#6-deep-research)
7. [Document QA (File Answer)](#7-document-qa-file-answer)
8. [Vector Similarity Search](#8-vector-similarity-search)
9. [Data Ingestion Pipeline](#9-data-ingestion-pipeline)
10. [Team Context & External Research Data](#10-team-context--external-research-data)
11. [Admin Dashboard API](#11-admin-dashboard-api)
12. [Admin Authentication (JWT + TOTP)](#12-admin-authentication-jwt--totp)
13. [User Authentication](#13-user-authentication)
14. [Token Usage Analytics](#14-token-usage-analytics)
15. [Observability & Logging](#15-observability--logging)
16. [PDF Parsing & Indexing Pipeline](#16-pdf-parsing--indexing-pipeline)

---

## 1. Document Management

**Route file**: `src/routes/file.routes.ts`
**Services**: `src/service/files.ts`, `src/service/googleStorage.ts`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/files` | List user files (paginated, filterable by status/search) |
| GET | `/api/v1/files/:id` | Get file details with signed PDF URL |
| POST | `/api/v1/files/upload` | Upload PDF via multipart form |
| POST | `/api/v1/files/admin/upload` | Upload admin file (visible to all org users) |
| POST | `/api/v1/files/upload-url` | Get signed URL for client-side direct upload |
| POST | `/api/v1/files/parse-async` | Trigger async parsing for an existing file |
| DELETE | `/api/v1/files/:id` | Delete file + all related data (pages, chunks, chapters, sections) |
| GET | `/api/v1/files/pages` | Get parsed pages of a file |
| GET | `/api/v1/files/chapters` | Get extracted chapters |
| GET | `/api/v1/files/sections` | Get extracted sections |
| GET | `/api/v1/files/hierarchical-index` | Get hierarchical document structure |

### How It Works
- Files are uploaded to **Google Cloud Storage** with path `files/{userId}/{fileId}/document.pdf` (or `files/admin/{orgId}/...` for admin files)
- After upload, a parsing job is queued via **QStash** which triggers the parsing callback
- Access control: users see their own files + admin files in their org
- Deletion cascades across all related tables (pages, chunks, chapters, sections, clusters, hierarchical index) and GCS

### Analysis

**Strengths:**
- Clean separation of upload → queue → parse → callback flow
- Admin file concept (org-wide visibility) is well thought out
- Signed URLs for both download and direct upload

**Issues & Improvements:**
- **Route file is 600+ lines** — extract into controller/handler modules for upload, listing, and management operations
- **No file type validation beyond PDF** — the upload endpoint should validate MIME type and file extension before accepting
- **No file size pre-check** — the multipart plugin has a 50MB limit, but there's no user-friendly error for oversized files
- **Delete doesn't verify GCS deletion succeeded** — if GCS delete fails, DB records are still removed, creating orphaned files in storage
- **No bulk delete** — users can only delete one file at a time
- **Missing pagination on chapters endpoint** — unlike pages and sections which support limit/offset

---

## 2. Chat & Streaming

**Route file**: `src/routes/chatStream.routes.ts`, `src/routes/chatSession.routes.ts`
**Services**: `src/db/mutation/session.ts`, `src/db/queries/message.ts`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/chat-session` | Create new chat session |
| GET | `/api/v1/chat-session` | List sessions (cursor pagination) |
| GET | `/api/v1/chat-session/:id` | Get session with all messages |
| POST | `/api/v1/chat` | Stream AI response (SSE) |

### How It Works
- Sessions are created per user with a title
- The chat endpoint accepts `{messages, sessionId, deepSearch}` and returns an SSE stream
- Two modes:
  - **Knowledge Base mode**: uses `knowledgeBaseTool` for similarity search over user documents
  - **Deep Search mode**: uses `chapterAgentV3` for multi-step chapter analysis
- After 2 messages, the session title is auto-summarized by the LLM
- Messages (user + assistant) are saved to DB after streaming completes

### Analysis

**Strengths:**
- SSE streaming via AI SDK provides real-time response delivery
- Cursor-based pagination on session listing is correct for timeline data
- Auto-title summarization is a nice UX touch

**Issues & Improvements:**
- **No message editing or deletion** — users cannot correct or remove messages from a session
- **No session deletion** — stale sessions accumulate indefinitely
- **Deep search mode is tightly coupled** — the route handler has inline agent orchestration logic that should be extracted to a service
- **No streaming error recovery** — if the stream breaks mid-response, there's no mechanism for the client to resume
- **Session title summarization runs on every response after message 2** — should only run once or on explicit trigger to save LLM calls

---

## 3. Financial Research Agent (FinAgent)

**Route file**: `src/routes/finAgent.routes.ts`
**Agent**: `src/agents/finAgent.ts`
**Tools**: `src/agents/tools/` (12+ tool files)

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/agent/fin` | Financial agent streaming chat |

### How It Works
- The main intelligence hub — accepts messages and streams agentic responses
- Has access to 12+ tools: file search, file answer, chunk search, chapter search, web doc search, web search, bulk file indexing, file status, team context, todo list
- Uses Gemini 2.5 Flash by default (configurable)
- Max 15 tool calls per request
- Web search tools are **permission-gated**: agent must ask user before searching the web
- Traces all tool calls via Laminar AI
- Logs tool failures with context (toolName, input, error)

### Analysis

**Strengths:**
- Permission-gated web search is an excellent trust pattern
- Rich tool ecosystem covers most financial research needs
- Tool failure logging enables debugging without blocking the user
- Strict "only use tool-returned information" prompt prevents hallucination

**Issues & Improvements:**
- **15 tool call limit is hardcoded** — should be configurable per request or session
- **No tool call cost estimation** — users don't know how expensive a query will be before it runs
- **No conversation memory across sessions** — each request is stateless; the agent can't reference prior research
- **Model selection is per-request** — no way to set org-level or user-level default model preferences
- **No agent timeout** — a complex multi-tool chain could run indefinitely; add a global timeout
- **Tool registration is imperative** — tools are added inline in the route handler; consider a tool registry pattern for cleaner management

---

## 4. Web Search & Document Discovery

**Route files**: `src/routes/webSearch.routes.ts`, `src/routes/webSearchCallback.routes.ts`
**Agent**: `src/agents/webAgent.ts`
**Tools**: `src/agents/tools/websearch.ts`, `src/agents/tools/webDocSearchTool.ts`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/agent/web-search/tasks` | Create background web search task |
| GET | `/api/v1/agent/web-search/tasks` | List user's search tasks |
| GET | `/api/v1/agent/web-search/tasks/:id` | Get specific task with results |
| POST | `/api/v1/agent/web-search/tasks/retry` | Retry a failed task |
| POST | `/api/v1/agent/web-search/doc-agent-search` | Direct web agent invocation (legacy) |
| POST | `/api/v1/web-search-callback` | QStash callback (internal) |

### How It Works
- Tasks are queued via QStash for background processing (5 min timeout)
- The **WebAgent** uses Exa API for search and Firecrawl for JS-heavy page scraping
- Specialized financial document strategy: finds investor relations pages → navigates to financial docs → returns direct PDF links
- Results stored in DB: sources array + helpfulText summary
- The `webDocSearchTool` orchestrates: search → discover → optionally ingest into knowledge base

### Analysis

**Strengths:**
- Async task model is correct for potentially slow web searches
- Financial document strategy (IR pages → SEC filings → PDFs) is domain-specific and valuable
- Retry mechanism for failed tasks

**Issues & Improvements:**
- **5-minute timeout may be too short** for complex multi-step web research
- **No deduplication of search results** — the same URL can appear in multiple tasks
- **Legacy `doc-agent-search` endpoint** still exists — should be deprecated with a redirect or removed
- **No search result caching** — identical queries always re-execute from scratch
- **QStash callback has no idempotency check** — if the callback is delivered twice, results could be duplicated
- **No rate limiting on task creation** — a user could flood the queue with tasks

---

## 5. Structured Reports

**Route files**: `src/routes/structuredReport.routes.ts`, `src/routes/structuredReportCallback.routes.ts`
**Agent**: `src/agents/report/structuredReport.ts`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/report/templates` | Create report template |
| GET | `/api/v1/report/templates` | List all templates |
| POST | `/api/v1/report/reports` | Create report from template |
| GET | `/api/v1/report/reports` | List user's reports |
| GET | `/api/v1/report/reports/:id` | Get report by ID |
| POST | `/api/v1/structured-report-callback` | QStash callback (internal) |

### How It Works
4-step pipeline:
1. **Initial Research** — broad document search and synthesis based on template task description
2. **Sub-questions Identification** — break the topic into focused research questions
3. **Sub-question Answering** — answer each question in parallel (max 10 concurrent, uses file answer agent)
4. **Final Report** — synthesize all findings into a structured markdown report with citations

Templates define custom prompts for each step. Reports track `stepOutputs` and token `usageRecord` per model. Processing is async via QStash with retry logic (3 retries).

### Analysis

**Strengths:**
- Template-driven design allows reusable report formats
- Parallel sub-question processing with `pLimit(10)` is efficient
- Step-by-step output persistence enables resumability
- Citation tracking through the entire pipeline

**Issues & Improvements:**
- **No template versioning** — editing a template affects future reports but there's no history
- **No report cancellation** — once queued, a report runs to completion or failure
- **No partial result visibility** — users can't see step 1 results while step 2 is running
- **No template sharing across orgs** — templates are global, not org-scoped
- **Sub-question limit (10 concurrent) is hardcoded** — should be configurable per template
- **No report export** — generated reports are only available via API; no PDF/DOCX export
- **Retry logic retries the entire step** — for sub-question answering, only the failed questions should be retried

---

## 6. Deep Research

**Agent**: `src/agents/deepResearch/index.ts`, `src/agents/deepResearch/chapter.ts`

### How It Works
Accessed via the chat endpoint when `deepSearch` mode is selected:
1. **Query Expansion** — rewrites the user query for better retrieval
2. **Chapter Filtering** — identifies relevant chapters across all documents
3. **Iterative Chunk Analysis** — semantic search within chapters, deduplicating already-seen chunks
4. **Response Synthesis** — combines findings into a comprehensive answer

Uses Claude 4 Sonnet for heavy reasoning tasks.

### Analysis

**Strengths:**
- Iterative approach with chunk deduplication avoids redundant analysis
- Query expansion improves recall for vague queries
- Chapter-level filtering is more efficient than searching all chunks

**Issues & Improvements:**
- **No depth/breadth control** — users can't specify whether they want a quick or exhaustive search
- **No progress reporting** — unlike structured reports, deep research doesn't stream intermediate steps
- **Tightly coupled to chat route** — should be a standalone service callable from multiple entry points
- **No result caching** — identical queries re-execute the full pipeline
- **Chapter agent uses a different model (Claude) than the rest of the system (Gemini)** — consider standardizing or making configurable

---

## 7. Document QA (File Answer)

**Agents**: `src/agents/document/fileAnswerTableOfContent.ts`, `src/agents/document/fileAnswerChunkSearch.ts`, `src/agents/document/docAnswer.ts`

### How It Works
Two approaches:

**TOC-based (primary):**
1. Loads file metadata, table of contents, and structured reports
2. Agent examines TOC to identify relevant sections
3. Fetches specific pages via `fetchPagesFromFile` tool
4. Falls back to `similaritySearchChunks` if TOC doesn't help
5. Synthesizes answer with `[file_ID/page=N]` citations

**Chunk-based (alternative):**
1. Query expansion (if no fileIds provided)
2. Document filtering via `documentFilter()` agent
3. Semantic chunk search with pagination and exclusion
4. Query agent synthesizes results

Both support multi-file queries and structured report content.

### Analysis

**Strengths:**
- Dual approach (TOC vs chunk) provides flexibility for different document types
- Citation format is consistent and machine-parseable
- Multi-file support enables cross-document analysis

**Issues & Improvements:**
- **Two implementations with overlapping logic** — the TOC and chunk approaches share significant code; extract shared utilities
- **No confidence scoring on answers** — the agent doesn't indicate how certain it is about the answer
- **No answer caching** — the same question about the same document always re-runs
- **Page fetching has no size limit** — fetching many pages at once could exceed LLM context
- **Structured report handling is bolted on** — it should be a first-class document type, not a special case

---

## 8. Vector Similarity Search

**Service**: `src/service/simSearch.ts`
**DB Queries**: `src/db/queries/simChunks.ts`

### How It Works
Provides similarity search across four levels:
- `similaritySearchChunks()` — search text chunks (most granular)
- `similaritySearchDocuments()` — search document-level embeddings
- `similaritySearchChapters()` — search chapter summaries
- `similaritySearchClusters()` — search page clusters

All use **768-dimensional embeddings** with cosine distance via pgvector. Supports filtering by documentIds, chapterIds, userId, orgId.

### Analysis

**Strengths:**
- Multi-level search (chunk → chapter → document) matches different retrieval needs
- pgvector integration is clean and uses standard SQL

**Issues & Improvements:**
- **No result re-ranking** — results are returned in raw similarity order; a cross-encoder re-ranker would improve precision
- **No hybrid search** — only vector similarity, no BM25/keyword component; hybrid retrieval typically performs better
- **Embedding dimension (768) is hardcoded** — if the embedding model changes, schema migration is required
- **No index optimization visible** — pgvector indexes (IVFFlat or HNSW) should be configured for large collections
- **No embedding cache** — re-embedding the same query text on every request wastes compute
- **No search analytics** — no tracking of which queries return poor results (for retrieval improvement)

---

## 9. Data Ingestion Pipeline

**Route file**: `src/routes/ingestion.routes.ts`
**Service**: `src/service/ingestion/index.ts`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/webhooks/ingestion` | External data ingestion webhook |

### How It Works
Receives webhook events from an external system with:
- `type`: highlight, entity, tag, trend, scenario, document, organization, account, accounts_membership
- `action`: insert, update, delete
- `data`: the payload

Each type maps to a table with specific insert/update/delete logic. Documents and highlights also generate embeddings on ingest.

### Analysis

**Strengths:**
- Event-driven architecture decouples data sync from the source system
- QStash signature verification ensures webhook authenticity
- Handles all CRUD actions (insert, update, delete)

**Issues & Improvements:**
- **No dead letter queue** — failed ingestion events are logged but not retried or stored for manual replay
- **No schema validation per type** — the payload structure is loosely typed; a Zod schema per event type would prevent bad data
- **No idempotency** — duplicate webhook deliveries could insert duplicate records
- **Embedding generation is synchronous** — blocks the webhook response; should be queued
- **No event ordering guarantees** — if update arrives before insert, data could be inconsistent
- **No ingestion monitoring dashboard** — would be useful to see event throughput, error rates, and lag

---

## 10. Team Context & External Research Data

**Tool**: `src/agents/tools/teamContext.ts`
**Service**: `src/service/externalContext.ts`

### How It Works
Provides the FinAgent with access to team-curated research data:
- **Highlights** — team research notes with tags and entity links
- **Trends** — market/entity trends with asset-level detail
- **Scenarios** — scenario analyses with probability and impact ratings
- **Calendar** — market events with entity links
- **Entity search** — keyword and semantic search for entities

All queries are filtered by `teamIds` (from auth context). Supports date range filtering and pagination (max 50 results).

### Analysis

**Strengths:**
- Rich categorization of research data (highlights, trends, scenarios, calendar)
- Both keyword and semantic entity search
- Automatic team-scoping prevents data leakage

**Issues & Improvements:**
- **No write operations** — the agent can read team context but can't add highlights or tag entities from its research
- **Pagination cap of 50** — may be insufficient for teams with large research libraries
- **No relevance scoring** — results are returned chronologically, not by relevance to the current query
- **Entity embeddings are stripped before returning** — wastes bandwidth on the DB query; filter at the query level
- **No team context caching** — frequently accessed team data is re-queried every time

---

## 11. Admin Dashboard API

**Route files**: `src/routes/admin.routes.ts`, `src/routes/adminPlayground.routes.ts`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/orgs` | List all organizations with document counts |
| GET | `/api/v1/admin/documents` | List documents across orgs (filterable) |
| GET | `/api/v1/admin/documents/:id` | Document detail with signed URL |
| GET | `/api/v1/admin/documents/:id/pages` | Paginated pages |
| GET | `/api/v1/admin/documents/:id/page/:pageNumber` | Single page content |
| GET | `/api/v1/admin/documents/:id/sections` | Document sections |
| GET | `/api/v1/admin/documents/:id/chapters` | Document chapters |
| GET | `/api/v1/admin/documents/:id/toc-meta` | TOC and extracted metadata |
| GET | `/api/v1/admin/entities` | List entities by org |
| GET | `/api/v1/admin/entities/:entityId` | Entity detail with highlights |
| GET | `/api/v1/admin/playground/members` | List org members |
| POST | `/api/v1/admin/playground/chat` | Admin impersonation chat |
| GET/POST | `/api/v1/admin/playground/templates` | Report template management |
| GET/POST | `/api/v1/admin/playground/reports` | Report management for any user |
| GET | `/api/v1/admin/playground/reports/:id` | Report detail |

### Analysis

**Strengths:**
- Comprehensive read-only views for document and entity management
- Admin impersonation chat for debugging user issues
- Org-level aggregation for document counts

**Issues & Improvements:**
- **Route file is 600+ lines** — needs extraction into handler modules
- **No RBAC** — all admins have the same access level; no distinction between read-only and super admin
- **No audit logging** — admin actions (especially impersonation chat) should be logged for compliance
- **No bulk operations** — can't reprocess multiple documents or delete across orgs
- **Entity management is read-only** — no way to merge duplicate entities or edit metadata
- **No admin-initiated file reprocessing** — if parsing fails, the admin can't trigger a re-parse from the dashboard

---

## 12. Admin Authentication (JWT + TOTP)

**Route file**: `src/routes/adminAuth.routes.ts`
**Plugin**: `src/plugins/adminAuth.plugin.ts`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/admin/auth/login` | Password login → challenge token |
| POST | `/api/v1/admin/auth/verify-totp` | TOTP verification → JWT access token |
| GET | `/api/v1/admin/auth/me` | Validate current admin session |

### How It Works
1. Admin submits username + password → bcrypt verification → challenge token (5 min TTL)
2. Admin submits challenge token + TOTP code → JWT access token (8 hour TTL)
3. JWT is signed with `ADMIN_JWT_SECRET` via the `jose` library

Admin credentials stored in `admin-secrets.json`: `{userId, passwordHash, totpSecret}`.

### Analysis

**Strengths:**
- Two-factor authentication (password + TOTP) is good security practice
- Challenge token prevents TOTP replay attacks
- Configurable TTLs for both challenge and access tokens

**Issues & Improvements:**
- **No rate limiting on login attempts** — vulnerable to brute-force attacks
- **TOTP secrets stored in plaintext JSON file** — should use a secrets manager (GCP Secret Manager)
- **No session revocation** — once a JWT is issued, it's valid until expiry; no way to force logout
- **No password rotation policy** — admin passwords never expire
- **No login attempt logging** — failed logins should be tracked for security monitoring
- **Challenge token stored in memory** — won't survive server restarts; use Redis or DB

---

## 13. User Authentication

**Plugin**: `src/plugins/auth.plugin.ts`

### How It Works
- Validates `Authorization: Bearer <BACKEND_TOKEN>` against a single env var
- Extracts `x-user-id` and `x-org-id` from headers
- Fetches team memberships from `accounts_membership` table
- Decorates `request.user` with `{id, email, name, orgId, teamIds}`

### Analysis

**Strengths:**
- Simple and fast validation for service-to-service auth
- Team membership loading enables org-scoped data access

**Issues & Improvements:**
- **Single shared token for all users** — there's no per-user authentication; the frontend is trusted to send correct user IDs
- **No token rotation** — if the token is compromised, all users are affected
- **No JWT verification** — the token is compared as a plain string, not cryptographically verified
- **No HTTPS enforcement** — tokens could be intercepted in transit
- **x-user-id header is trusted without verification** — any caller with the BACKEND_TOKEN can impersonate any user
- **No per-endpoint authorization** — all authenticated users have the same access to all endpoints

---

## 14. Token Usage Analytics

**Route file**: `src/routes/analytics.routes.ts`
**DB Table**: `token_usage_log`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/analytics/token-usage/summary` | Aggregated usage by model |
| GET | `/api/v1/analytics/token-usage/by-user` | Top users by consumption |
| GET | `/api/v1/analytics/token-usage/by-operation` | Most expensive operations |

### How It Works
- Every LLM call logs: model, prompt tokens, completion tokens, total tokens, cost estimate, operation name, userId, orgId, sessionId
- Analytics endpoints aggregate with date range filters
- Supports filtering by userId, orgId, sessionId

### Analysis

**Strengths:**
- Granular per-call tracking enables accurate cost attribution
- Multiple aggregation dimensions (model, user, operation)
- Date range filtering for trend analysis

**Issues & Improvements:**
- **No cost alerting** — no mechanism to notify when a user or org exceeds a spending threshold
- **No usage quotas** — users can consume unlimited tokens
- **No real-time dashboard** — analytics are pull-only via API
- **No cost estimation before execution** — users can't preview expected cost for a report or research task
- **Historical data retention policy undefined** — token logs will grow indefinitely

---

## 15. Observability & Logging

**Utils**: `src/utils/logger.ts`, `src/utils/requestContext.ts`, `src/utils/otel.ts`
**Plugin**: `src/plugins/logging.plugin.ts`

### How It Works

**Request Logging:**
- Every request gets a unique `requestId` (UUID v4)
- `AsyncLocalStorage` propagates context across async boundaries
- Response includes `X-Request-ID` header
- Slow requests (>5s) are flagged with warnings
- Headers are sanitized (authorization, cookies, API keys redacted)

**Structured Logging (Pino):**
- JSON format in production, pretty-print in development
- Auto-includes: requestId, userId, orgId, sessionId, path, method
- Child loggers with fixed context for subsystems

**Distributed Tracing (OpenTelemetry):**
- Auto-instrumentation for HTTP and Fastify
- Exporters: OTLP (generic) or Google Cloud Trace
- Axiom shortcut via `AXIOM_TOKEN` env var

**LLM Tracing (Laminar AI):**
- Agent step tracing via `lmnr` observer
- Tool call tracking with input/output

### Analysis

**Strengths:**
- Excellent request context propagation via AsyncLocalStorage
- Multiple exporter support (OTLP, GCP, Axiom)
- Slow request detection is valuable for performance monitoring
- Header sanitization prevents credential leakage in logs

**Issues & Improvements:**
- **OpenTelemetry log emission errors are silently swallowed** — should at minimum log to stderr
- **No structured log schema** — log fields vary by subsystem; a standard schema would improve queryability
- **No log sampling in production** — high-traffic endpoints could generate excessive log volume
- **Pino and OTEL logging are separate paths** — could lead to inconsistencies if one fails
- **No health check for OTEL exporter** — if the exporter endpoint is down, logs/traces are lost silently

---

## 16. PDF Parsing & Indexing Pipeline

**Route file**: `src/routes/parsingCallback.routes.ts`
**Services**: `src/service/file/` directory

### How It Works
Multi-stage async pipeline triggered after file upload:

1. **PDF Parsing** (`parse_pdf`) — extract text content per page
2. **Metadata Extraction** (`parse_metadata`) — title, summary, year, document type, industry, companies
3. **Outline Extraction** (`parse_outline`) — chapters and sections with page ranges
4. **Hierarchical Index** (`parse_heirarchial_index`) — multi-level document structure
5. **Chunk Generation** — split pages into overlapping chunks with 768-dim embeddings
6. **Chapter Embeddings** — generate embeddings for chapter summaries

Each stage is triggered via QStash callback to `/api/v1/callbacks/parsing/:fileId`. Token usage is tracked per parsing operation.

### Analysis

**Strengths:**
- Multi-stage pipeline is well-decomposed and resumable
- QStash callbacks enable async processing without blocking
- Hierarchical indexing (chapter → section → subsection) enables intelligent navigation
- Token usage tracking per parsing operation

**Issues & Improvements:**
- **No stage-level retry** — if metadata extraction fails, the entire file is marked failed; individual stages should be retryable
- **No parsing progress visibility** — users see "pending" or "completed" but not which stage is currently running
- **No support for non-PDF formats** — Word, Excel, PowerPoint, and HTML documents are not supported
- **Chunk overlap strategy is not configurable** — different document types may benefit from different chunking strategies
- **No OCR support** — scanned PDFs with image-based text will produce empty pages
- **No incremental re-indexing** — if the chunking or embedding model changes, all files must be reprocessed manually
- **Parsing callback has no auth** — relies solely on QStash signature; if someone discovers the callback URL pattern, they could send fake completion events

---

## Cross-Cutting Concerns

### Issues That Affect Multiple Features

1. **No environment variable validation at startup** — 87+ env vars with no schema; missing vars cause runtime crashes instead of fast failure
2. **Inconsistent response format** — some endpoints return `{data: T}`, others `{success: boolean, data: T}`; standardize on one
3. **No request rate limiting** — no rate limiting on any user-facing endpoint
4. **No test framework** — tests are standalone scripts with manual pass/fail; adopt Vitest for automated testing
5. **Magic numbers scattered in code** — embedding dimension 768, timeouts, limits — extract to constants
6. **No database transaction wrapper** — multi-step mutations lack consistent transaction handling
7. **Error handling gaps** — some `.catch(() => {})` patterns silently swallow errors
