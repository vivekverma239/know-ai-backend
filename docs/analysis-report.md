# Codebase Analysis Report

Comprehensive deep-dive analysis of every feature in the Knowsis AI Backend, produced by 16 specialized code exploration agents. Each finding includes exact file:line references and specific fix suggestions.

---

## Executive Summary

### Top 10 Critical Findings

| # | Finding | Severity | Feature |
|---|---------|----------|---------|
| 1 | **No vector indexes (HNSW/IVFFlat) on any embedding column** — every similarity search is a full sequential scan | Critical | Vector Search |
| 2 | **Production connection pool leak** — `getDb()` creates a new pool on every call in production | Critical | Database |
| 3 | **Cross-tenant data leak in chapter search** — `chapterFilter.ts:158` runs without userId/orgId | Critical | Vector Search |
| 4 | **Empty `teamIds` bypasses all team filtering** — returns all teams' data | Critical | Team Context |
| 5 | **Token usage write path never reaches DB** — `traceManager.recordTokenUsage` only stores in memory | Critical | Analytics |
| 6 | **No auth on analytics endpoints** — any unauthenticated caller can query all usage data | Critical | Analytics |
| 7 | **Unauthenticated parsing callback** — anyone can inject content into any document | Critical | PDF Parsing, Document Mgmt |
| 8 | **Entire typed error class hierarchy is dead code** — never imported by any route or service | High | Error Handling |
| 9 | **Privilege escalation on admin upload** — any authenticated user can create org-wide files | High | Document Mgmt |
| 10 | **Race condition in structured report sub-questions** — concurrent closures overwrite same array | High | Structured Reports |

### Issue Count by Feature

| Feature | Critical | High | Medium | Low | Total |
|---------|----------|------|--------|-----|-------|
| Document Management | 2 | 3 | 3 | 2 | 10 |
| Chat & Streaming | 0 | 2 | 5 | 3 | 10 |
| FinAgent | 0 | 3 | 4 | 2 | 9 |
| Web Search | 0 | 2 | 5 | 5 | 12 |
| Structured Reports | 0 | 3 | 4 | 3 | 10 |
| Deep Research & Doc QA | 0 | 2 | 5 | 3 | 10 |
| Vector Search | 2 | 3 | 3 | 2 | 10 |
| Ingestion Pipeline | 0 | 3 | 4 | 3 | 10 |
| Team Context | 1 | 2 | 4 | 3 | 10 |
| Admin Dashboard | 0 | 3 | 5 | 4 | 12 |
| Auth System | 0 | 4 | 4 | 3 | 11 |
| Token Analytics | 2 | 2 | 3 | 1 | 8 |
| Observability | 0 | 2 | 4 | 4 | 10 |
| PDF Parsing | 0 | 3 | 4 | 3 | 10 |
| Database Layer | 2 | 3 | 3 | 2 | 10 |
| Error Handling | 0 | 3 | 4 | 3 | 10 |

---

## 1. Document Management

**Files**: `src/routes/file.routes.ts`, `src/service/files.ts`, `src/service/googleStorage.ts`, `src/service/file/storagePath.ts`

### Critical Issues

- **Unauthenticated parsing callback** (`parsingCallback.routes.ts:22`) — No `preHandler` or token verification. Anyone who knows a `fileId` can POST arbitrary parsed content.
- **Privilege escalation** (`file.routes.ts:690`) — `TODO: Add admin role check` — any authenticated user can upload org-wide admin files.

### High Issues

- **ReDoS via regex injection** (`file.routes.ts:115`) — Search uses `~*` regex operator with unsanitized user input. A crafted `search=(.*){10,}` causes catastrophic backtracking.
- **Delete without transaction** (`file.routes.ts:493-501`) — 7 sequential DELETE statements; partial failure leaves zombie records.
- **GCS `exists()` swallows all errors** (`googleStorage.ts:168-176`) — Returns `false` for permission errors, network failures — not just missing files.

### Medium Issues

- Route file is 600+ lines — extract into handler modules.
- No file type validation beyond PDF on upload.
- `resolveExistingPdfStoragePath` makes up to 6 sequential GCS requests per access with no caching.
- `parse-async` route returns Drizzle mutation object, not the actual record (missing `.returning()`).

### Improvements

```typescript
// Fix 1: Authenticate parsing callback (parsingCallback.routes.ts:22)
preHandler: async (request, reply) => {
  const token = request.headers['x-callback-token'];
  if (token !== process.env.CALLBACK_SECRET) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

// Fix 2: Wrap delete in transaction (file.routes.ts:493)
await getDb().transaction(async (tx) => {
  await tx.delete(userFileSection).where(eq(userFileSection.fileId, id));
  // ... all other deletes ...
  await tx.delete(userFile).where(eq(userFile.id, id));
});

// Fix 3: Escape regex in search (file.routes.ts:114)
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchTerms = search?.trim().split(/\s+/).filter(Boolean).map(escapeRegex);
```

---

## 2. Chat & Streaming

**Files**: `src/routes/chatStream.routes.ts`, `src/routes/chatSession.routes.ts`, `src/db/queries/message.ts`

### High Issues

- **Scope capture bug** (`chatStream.routes.ts:111`) — `saveMessage` references outer `messages` variable instead of `msgs` parameter for title summarization.
- **GET endpoint has write side-effect** (`message.ts:82-88`) — `getSessionWithMessages` auto-creates sessions for any UUID, even on GET requests.

### Medium Issues

- **Stale date in system prompts** (`chatStream.routes.ts:25,27`) — `new Date().toISOString()` evaluated once at module load, frozen for server lifetime.
- Session ownership returns 400 instead of 403/404 (`chatStream.routes.ts:87-89`).
- `syncMessages` uses N individual INSERTs inside `Promise.all` instead of bulk insert.
- `summarizeChat` runs synchronously in `onFinish`, blocking message persistence.
- Cursor pagination leaks cross-user session `createdAt` timestamps (`message.ts:120-122`).

### Improvements

```typescript
// Fix scope bug (chatStream.routes.ts:111)
// Before: messages.map((m: CoreMessageExt) => ({  // outer scope
// After:  msgs.map((m: CoreMessageExt) => ({       // function parameter

// Fix GET side-effect (message.ts:82-88)
if (!session) return null;  // Let caller return 404
```

---

## 3. Financial Research Agent (FinAgent)

**Files**: `src/agents/finAgent.ts`, `src/agents/prompts.ts`, `src/agents/tools/*`

### High Issues

- **Wrong model in usage tracking** (`fileSearchAgent.ts:101`) — Reports `GROK_CODE_FAST_1` when actual model is `GEMINI_2_5_FLASH_LITE`.
- **Entity search missing teamIds** (`teamContext.ts:115-119`) — `searchExternalEntities` called without team filter, leaking cross-team data.
- **Inconsistent citation format** — `common.ts` uses `[fileID/page=N]`, `prompts.ts` uses `[file_<ID>/page=N]`, sub-agents diverge.

### Medium Issues

- `fileStatusTool` always registered even when `webSearch=false` (dead tool in non-web sessions).
- `todoListTool` writer never wired — `context.writer?.write(...)` is always a no-op.
- No agent timeout — a single `webDocSearchTool` call can trigger 30+ LLM steps with no deadline.
- Sequential DB calls in `getAllFilesTocInfo` — N files = N sequential round-trips.

### Improvements

```typescript
// Fix model reporting (fileSearchAgent.ts:101)
context.addUsage?.({ usage: result.usage, model: MODELS.GEMINI_2_5_FLASH_LITE });

// Fix team isolation (teamContext.ts:118)
const result = await searchExternalEntities({ query, limit, teamIds: context.teamIds });

// Gate fileStatusTool (finAgent.ts:161)
...(webSearch ? { fileStatusTool: getFileStatusTool({ context: toolContext }) } : {}),
```

---

## 4. Web Search & Document Discovery

**Files**: `src/routes/webSearch.routes.ts`, `src/routes/webSearchCallback.routes.ts`, `src/agents/webAgent.ts`, `src/agents/tools/websearch.ts`

### High Issues

- **Tool name mismatch** (`webAgent.ts:66-67 vs 136-139`) — System prompt references `exaSearch`/`exaWebsiteContent` but tools registered as `webSearchTool`/`webPageScrapeTool`.
- **Timer leak in timeout** (`webSearchCallback.routes.ts:117-128`) — `setTimeout` never cleared, timed-out agent continues executing in background.

### Medium Issues

- Duplicate JSON parse (`webAgent.ts:170-187`) — identical `parseJson` called twice on same input.
- Shared QStash flow-control key (`qstash.ts:22-25`) — web search and PDF parsing share `"pdf-parser"` parallelism=2.
- `webAgentComplex` and `SYSTEM_PROMPT_COMPLEX` are dead code (never imported).
- Exa/Firecrawl clients re-instantiated on every tool call.
- Return 200 (not 400) when task already processed, to prevent QStash retry waste.

### Improvements

```typescript
// Fix tool name mismatch (webAgent.ts:136-139)
tools: {
  exaSearch: getWebSearchTool({ context }),
  exaWebsiteContent: getFirecrawlScrapeTool({ context }),
}

// Fix timeout with AbortController (webSearchCallback.routes.ts:117)
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
try {
  const result = await webAgent(task.query, { ...context, abortSignal: controller.signal });
  clearTimeout(timeoutId);
} catch (error) { clearTimeout(timeoutId); throw error; }
```

---

## 5. Structured Reports

**Files**: `src/agents/report/structuredReport.ts`, `src/agents/report/subquestionProcessor.ts`, `src/routes/structuredReport.routes.ts`

### High Issues

- **Race condition in Step 3** (`structuredReport.ts:475-484`) — Concurrent `pLimit(10)` closures read/write same `stepOutputs.subQuestionAnswer.subQuestions` array. Last writer wins, losing answers.
- **Missing authorization** (`structuredReport.routes.ts:136-143`) — `GET /reports/:id` has no ownership check; any user can read any report.
- **Unauthenticated callback** (`structuredReportCallback.routes.ts:22-23`) — Comment says "QStash verification would go here" — never implemented.

### Medium Issues

- `executeWithRetries` has no backoff, no logging, and `label` parameter is unused.
- `processFinalReport` is the most expensive step but has no retry wrapper.
- Sub-question failures silently absorbed (error answer passed to Step 4).
- Title/summary extraction failure kills entire report even though `finalOutput` was generated.

### Improvements

```typescript
// Fix race condition — collect results then persist once (structuredReport.ts:438-488)
const answers = await Promise.all(tasks);
stepOutputs.subQuestionAnswer = { subQuestions: answers };
await persistStepOutput(reportId, stepOutputs, usage);

// Fix authorization (structuredReport.routes.ts:136)
where: and(eq(structuredReports.id, id), eq(structuredReports.userId, userId)),
```

---

## 6. Deep Research & Document QA

**Files**: `src/agents/deepResearch/`, `src/agents/fileAgent/`, `src/agents/document/`, `src/agents/tools/fileAnswer*`

### High Issues

- **Three different citation formats** — `chapter.ts:113` uses `[1](/doc/{id}/page/{N})`, `common.ts:6` uses `[fileID/page=N]`, `docAnswer.ts:24` uses `[page_{N}]`.
- **Dead code accumulation** — `chunkSearch` in `deepResearch/index.ts` exported but never called; `chapterAgentV2` in `chapterFilter.ts` coexists with V3.

### Medium Issues

- Query expansion called twice — `processDeepSearchQuery` emits fake expansion step, then `chapterAgentV3` does the real one.
- `temperature: 2` in `deepResearch/index.ts:30` for structured extraction (should be 0).
- `alreadyLookedAtChunks` uses `Array` instead of `Set` — O(N) includes per chunk.
- `"use server"` Next.js directives in Fastify backend files.
- Duplicated `queryAgent` function in `chapter.ts` and `fileAnswerChunkSearch.ts`.

---

## 7. Vector Similarity Search

**Files**: `src/db/queries/simChunks.ts`, `src/service/simSearch.ts`, `src/ai-backend/embeddings.ts`

### Critical Issues

- **No HNSW/IVFFlat index on any embedding column** — All four 768-dim embedding columns (`chunk`, `user_file`, `file_chapter`, `file_cluster`) use full sequential scan. System will not scale beyond ~50K rows.
- **Cross-tenant chapter search** (`chapterFilter.ts:158`) — `getSimilarChapters` called without userId/orgId, returning chapters from all users.

### High Issues

- Subquery pattern prevents pgvector indexes from being used even if added.
- `getSimilarChunks` has no minimum similarity threshold (returns unrelated results).
- Silent retry loop returns `[]` on all failures with no logging.

### Improvements

```sql
-- Add HNSW indexes (new migration)
CREATE INDEX CONCURRENTLY chunk_embedding_hnsw_idx
  ON chunk USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
-- Repeat for file_chapter, file_cluster, user_file
```

```typescript
// Fix cross-tenant leak (chapterFilter.ts:158)
const chapters = await getSimilarChapters({
  embedding, limit: 25, page,
  userId,  // ADD
  orgId,   // ADD
});
```

---

## 8. Data Ingestion Pipeline

**Files**: `src/routes/ingestion.routes.ts`, `src/service/ingestion/`

### High Issues

- **Upsert overwrites AI-computed fields** (`index.ts:432-438`) — Highlight update zeroes out `contentEmbedding`, `imageParsedContent`, `aiSummary`.
- **Enrichment errors silently swallowed** (`highlightIngestion.ts:175-180`) — Embedding failures return 200 to QStash, no retry.
- **Webpage writes without transaction** (`webpageProcessing.ts:76-117`) — 5 sequential DB ops; crash leaves partial state.

### Medium Issues

- Missing delete handlers for `organization` and `account` types.
- Missing `calendar_event_entity` in `tableMap`.
- `getEmbeddings` retry counter bug — resets every iteration.
- 11-case insert/update switch is pure structural duplication.

### Improvements

```typescript
// Fix AI field preservation (index.ts:432-438)
const { contentEmbedding, imageParsedContent, aiSummary, ...coreData } = internalData;
await getDb().insert(highlights).values(internalData)
  .onConflictDoUpdate({ target: highlights.id, set: coreData }); // never overwrites AI fields
```

---

## 9. Team Context & External Research Data

**Files**: `src/agents/tools/teamContext.ts`, `src/service/externalContext.ts`

### Critical Issue

- **Empty `teamIds` bypasses all filtering** (`externalContext.ts:198-202`) — `buildTeamFilter` returns `undefined` when `teamIds` is `[]`, removing all team isolation.

### High Issues

- Embeddings fetched from DB then stripped in JS (`stripEmbeddings`) — should exclude at query projection level.
- Calendar events filtered by `createdAt` instead of event date (`fromDate`/`toDate`).

### Medium Issues

- 14 sequential DB queries in `getExternalContext` — many are independent and should be parallelized.
- `searchExternalTags` reimplements team filter inline instead of using `buildTeamFilter`.
- `semantic_search_entities` hardcoded similarity threshold 0.3 is too permissive.
- No pagination exposed to the LLM (no `offset` in tool schema).

### Improvements

```typescript
// Fix empty teamIds bypass (externalContext.ts:198-202)
if (filters.teamIds?.length) return inArray(column, filters.teamIds);
if (filters.teamId) return eq(column, filters.teamId);
return sql`false`;  // Block unscoped access instead of returning undefined
```

---

## 10. Admin Dashboard API

**Files**: `src/routes/admin.routes.ts` (875 lines), `src/routes/adminPlayground.routes.ts`, `src/routes/adminAuth.routes.ts`

### High Issues

- **No audit logging** — Admin impersonation chat, document access, report creation leave zero trace.
- **TOTP code reuse not prevented** — No in-memory set of consumed codes; replay within 90s window.
- **Challenge token not invalidated after use** — Can be resubmitted with fresh TOTP codes.

### Medium Issues

- `admin.routes.ts` at 875 lines needs splitting.
- `POST /reports` returns stale `"pending"` status after QStash failure.
- Document sub-resource endpoints don't validate parent document exists (return 200 + empty).
- `createdAt` fallback `?? new Date().toISOString()` silently masks data integrity issues.
- `isUuidLike` duplicated verbatim in two files.

---

## 11. Authentication System

**Files**: `src/plugins/auth.plugin.ts`, `src/plugins/adminAuth.plugin.ts`, `src/routes/adminAuth.routes.ts`

### High Issues

- **Plain string `===` comparison** (`auth.plugin.ts:44`) — Not timing-safe. Should use `crypto.timingSafeEqual`.
- **Auth plugin bypasses Fastify plugin system** (`server.ts:110-111`) — Uses `fastify.decorate` directly instead of `fastify.register`.
- **No rate limiting anywhere** — `@fastify/rate-limit` not installed or configured.
- **Admin secrets read from disk on every request** (`adminAuth.routes.ts:111,169`).

### Medium Issues

- 403 returned for invalid token (should be 401).
- TOTP secrets in plaintext JSON file, not secrets manager.
- No session revocation mechanism for either auth system.
- `x-user-email`/`x-user-name` headers accepted without validation.

### Improvements

```typescript
// Timing-safe comparison (auth.plugin.ts:44)
import { timingSafeEqual } from "node:crypto";
const expected = Buffer.from(process.env.BACKEND_TOKEN ?? "");
const actual = Buffer.from(token);
if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
  return reply.code(401).send({ error: "Invalid token" });
}
```

---

## 12. Token Usage Analytics

**Files**: `src/routes/analytics.routes.ts`, `src/utils/asyncHook.ts`, `src/utils/tokenlens.ts`, `src/ai-backend/llm.ts`

### Critical Issues

- **Write path never reaches DB** — `llm.ts` calls `traceManager.recordTokenUsage` (in-memory only), not `asyncHook.recordTokenUsage` (DB persist). The `token_usage_log` table may be empty.
- **No auth on analytics endpoints** (`server.ts:133`) — No `preHandler` or admin guard on any analytics route.

### High Issues

- `TokenUsageAggregator` memory leak — grows indefinitely, `clearUsage` never called.
- 27+ models missing from `TOKENLENS_MODEL_MAPPING` — cost defaults to $0.

### Medium Issues

- Double `CAST` on `costEstimate` column (already NUMERIC).
- `null` userId filter done in JS instead of SQL.
- No default time window — query with no dates triggers full-table scan.

---

## 13. Observability & Logging

**Files**: `src/utils/logger.ts`, `src/utils/requestContext.ts`, `src/utils/otel.ts`, `src/plugins/logging.plugin.ts`

### High Issues

- **OTEL errors silently swallowed** (`logger.ts:105`) — `emitOpenTelemetryLog` catches and discards all exceptions.
- **No trace-log correlation** — Log records don't include `traceId`/`spanId`, breaking Grafana/Jaeger linkage.

### Medium Issues

- Two `AsyncLocalStorage` instances (legacy + primary) both read on every log call — 3 object allocations per log.
- No SIGINT graceful shutdown — buffered telemetry lost on Ctrl-C.
- No field-level redaction in Pino or OTEL pipelines.
- `isDevelopment` check allows stack trace exposure for any non-`"production"` NODE_ENV value.

---

## 14. PDF Parsing & Indexing Pipeline

**Files**: `src/routes/parsingCallback.routes.ts`, `src/service/file/parsing.ts`, `src/service/file/triggerParsing.ts`

### High Issues

- **Premature `status: "completed"`** (`parsing.ts:364`) — `updateParsedMetadata` sets status to completed before pages/chapters arrive.
- **Sequential chapter embeddings** (`parsing.ts:72-80`) — 1 API call per chapter instead of batch.
- **`getEmbeddings` retry counter bug** (`embeddings.ts:33`) — `let retries = 0` inside `while(true)` resets every iteration.

### Medium Issues

- No stage-level status transitions — file stays `"pending"` on failure, no `"in_progress"` state.
- `updateChapterForChunks` N+1 pattern — one UPDATE per chapter.
- Three dead legacy trigger functions (240 lines of duplication).
- `"heirarchial"` misspelling baked into DB table names, types, and external API paths.

---

## 15. Database Layer

**Files**: `src/db/schema.ts`, `src/db/index.ts`, `src/db/queries/`, `src/db/mutation/`, `drizzle/`

### Critical Issues

- **Production connection pool leak** (`db/index.ts:19-20`) — `globalForDb.conn` only cached in non-production; each `getDb()` call in production creates a new pool.
- **No vector indexes** — Zero `USING hnsw` or `USING ivfflat` in any migration.

### High Issues

- `chunk.documentId` has no FK — orphaned chunks accumulate silently on file deletion.
- `UserFileChapter` export is `undefined` at runtime (`schema.ts:339` — value-level assignment of type property).
- `updateUsage` read-then-write without transaction — lost-update race condition.

### Medium Issues

- All FK constraints use `ON DELETE NO ACTION` — no cascading cleanup.
- `getMessages` fetches all messages with no limit and sorts in JavaScript.
- Missing indexes on `user_file(userId, orgId)`, `file_page(fileId)`, `message(sessionId, createdAt)`.

### Improvements

```typescript
// Fix production pool leak (db/index.ts:19-20)
if (!globalForDb.conn) {
  globalForDb.conn = postgres(databaseUrl, { max: 10, idle_timeout: 30 });
}
const conn = globalForDb.conn;

// Fix UserFileChapter (schema.ts:339)
export type UserFileChapter = typeof userFileChapter.$inferSelect;
```

---

## 16. Error Handling

**Files**: `src/utils/errorHandler.ts`, cross-codebase scan

### High Issues

- **Entire typed error hierarchy is dead code** — `AppError`, `ValidationError`, `AuthenticationError`, etc. are never imported or thrown by any route or service. All error responses use manual `reply.code(N).send()`.
- **Three competing response shapes** — `{error}`, `{message}`, and `{success, error, requestId}` used inconsistently across routes.
- **Completely empty catch** (`webAgent.ts:266`) — `catch (error) {}` with no logging.

### Medium Issues

- `unhandledRejection` handler logs but doesn't exit process.
- `asyncHandler` utility defined but never imported.
- `onFinish` callbacks in streaming routes have no try/catch — message persistence silently lost on error.
- `RetryableIngestionError` extends bare `Error`, not `AppError`.

### Improvements

The highest-leverage fix is adopting the typed error classes:

```typescript
// Instead of (current pattern everywhere):
return reply.code(401).send({ error: "Missing bearer token" });

// Throw typed errors:
throw new AuthenticationError("Missing bearer token");
// Global handler automatically adds requestId, sanitizes in prod, logs with context
```

---

## Cross-Cutting Recommendations (Priority Order)

### P0 — Security & Data Integrity

1. Add HNSW vector indexes on all embedding columns (migration)
2. Fix production connection pool leak in `db/index.ts`
3. Authenticate parsing callback endpoint
4. Fix empty `teamIds` bypass in `buildTeamFilter`
5. Add auth to analytics endpoints
6. Add rate limiting (`@fastify/rate-limit`) on admin auth endpoints
7. Fix cross-tenant chapter search in `chapterFilter.ts`

### P1 — Correctness

8. Wire token usage write path to actually persist to DB
9. Fix race condition in structured report sub-question accumulation
10. Fix scope capture bug in chat `saveMessage`
11. Fix premature `status: "completed"` in metadata parsing
12. Add foreign key on `chunk.documentId` with cascade delete
13. Fix `getEmbeddings` retry counter scope bug

### P2 — Code Quality & Consistency

14. Adopt typed error classes across all routes (eliminate manual `reply.send`)
15. Standardize error response shape to `{success, error, requestId}`
16. Extract access-control predicate into shared helper (used in 7+ places)
17. Split 600+ line route files into handler modules
18. Add env var validation at startup with Zod
19. Unify citation format across all agents

### P3 — Performance

20. Restructure vector search queries to allow index use (remove subquery pattern)
21. Batch chapter embeddings in parsing pipeline
22. Parallelize independent DB queries in team context and admin endpoints
23. Cache resolved GCS storage paths on `user_file` record
24. Replace N+1 `updateChapterForChunks` with single SQL CASE update
