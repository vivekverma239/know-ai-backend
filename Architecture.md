# Architecture

## Overview

Knowsis AI Backend is a **financial research intelligence platform** built on Fastify + TypeScript. It enables users to upload documents (PDFs, web articles), ask questions across their knowledge base using AI agents, generate structured reports, and perform web-based research — all with strict citation tracking and permission-gated workflows.

## System Diagram

```
                          ┌──────────────────────────────────┐
                          │         Client / Frontend        │
                          └──────────┬──────────┬────────────┘
                                     │          │
                              REST API    SSE Streaming
                                     │          │
┌────────────────────────────────────▼──────────▼────────────────────────────────┐
│                            Fastify Server (server.ts)                          │
│                                                                                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │   Plugins   │  │    Routes    │  │   Middleware  │  │   Error Handler   │   │
│  │  - CORS     │  │  (15 modules)│  │  - Auth      │  │  - AppError tree  │   │
│  │  - Multipart│  │              │  │  - AdminAuth │  │  - Global catch   │   │
│  │  - Swagger  │  │              │  │  - Logging   │  │  - Sanitization   │   │
│  └─────────────┘  └──────┬───────┘  └──────────────┘  └───────────────────┘   │
│                          │                                                     │
│  ┌───────────────────────▼─────────────────────────────────────────────────┐   │
│  │                         Agent Layer                                     │   │
│  │                                                                         │   │
│  │  ┌──────────┐ ┌───────────────┐ ┌────────────┐ ┌────────────────────┐  │   │
│  │  │FinAgent  │ │FileSearchAgent│ │ WebAgent   │ │StructuredReport   │  │   │
│  │  │(main hub)│ │(doc discovery)│ │(web search)│ │(4-step reports)   │  │   │
│  │  └────┬─────┘ └───────────────┘ └────────────┘ └────────────────────┘  │   │
│  │       │                                                                 │   │
│  │  ┌────▼──────────────────────────────────────────────────────────────┐  │   │
│  │  │                      Agent Tools (12+)                           │  │   │
│  │  │  fileAnswerTool · chunkSearchTool · chapterSearchTool           │  │   │
│  │  │  webDocSearchTool · webSearchTool · bulkFileIndexingTool        │  │   │
│  │  │  fileStatusTool · teamContextTool · todoListTools               │  │   │
│  │  └──────────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         Service Layer                                   │   │
│  │  simSearch · fileService · googleStorage · citations · embeddings      │   │
│  │  qstash · ingestion · externalContext · tokenUsage                     │   │
│  └─────────────────────────┬───────────────────────────────────────────────┘   │
│                            │                                                   │
│  ┌─────────────────────────▼───────────────────────────────────────────────┐   │
│  │                         Database Layer (Drizzle ORM)                     │   │
│  │  db/schema.ts · db/queries/ · db/mutation/                              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────┘
         │              │               │              │
         ▼              ▼               ▼              ▼
   ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
   │PostgreSQL│  │  Google   │  │  Upstash  │  │  LLM APIs │
   │+ pgvector│  │  Cloud    │  │  QStash   │  │ Gemini    │
   │          │  │  Storage  │  │           │  │ OpenAI    │
   │          │  │           │  │           │  │ Perplexity│
   └──────────┘  └───────────┘  └───────────┘  └───────────┘
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20, TypeScript 5.9 (strict mode) |
| **Framework** | Fastify 5.6 with plugin architecture |
| **ORM** | Drizzle ORM 0.44 with PostgreSQL dialect |
| **Database** | PostgreSQL + pgvector (768-dim embeddings) |
| **AI SDK** | Vercel AI SDK 5.0 (streamText, tool calling) |
| **LLM Providers** | Google Gemini, OpenAI, Perplexity, OpenRouter |
| **Object Storage** | Google Cloud Storage (with signed URLs) |
| **Task Queue** | Upstash QStash (async jobs with callbacks) |
| **Observability** | OpenTelemetry (traces + logs), Pino, Laminar AI |
| **Auth** | Bearer token (user API), JWT + TOTP (admin API) |
| **Linting** | Biome (format + lint in one tool) |
| **Deployment** | Docker multi-stage build (Node 20 Alpine) |

## Directory Structure

```
src/
├── server.ts               # Entry point — plugin/route registration
├── @types/                  # Domain type definitions
│   ├── index.ts             # Drizzle-inferred types (UserFile, Message, etc.)
│   ├── llm.ts               # MODELS enum (all supported LLMs)
│   ├── message.ts           # Chat message types (Role, MessageParts)
│   ├── agents.ts            # Agent step/approach types
│   ├── metadata.ts          # Document metadata structures
│   ├── fileIndex.ts         # Chapter/section/subsection hierarchy
│   ├── tokenUsage.ts        # Token tracking types
│   ├── queue.ts             # Async task queue types
│   └── parsedData.ts        # PDF parsing output types
├── plugins/
│   ├── auth.plugin.ts       # Bearer token + x-user-id/x-org-id validation
│   ├── adminAuth.plugin.ts  # JWT verification for admin dashboard
│   ├── cors.plugin.ts       # CORS configuration (origin allowlist)
│   ├── logging.plugin.ts    # Request logging, correlation IDs, slow request detection
│   └── multipart.plugin.ts  # File upload handling (50MB limit)
├── routes/                  # 15 route modules (see Features doc)
├── agents/                  # AI agent implementations
│   ├── finAgent.ts          # Main financial research agent (tool hub)
│   ├── webAgent.ts          # Web search and document discovery
│   ├── fileSearchAgent.ts   # Semantic document search
│   ├── deepResearch/        # Multi-step research with chapter analysis
│   ├── document/            # Document QA (TOC-based + chunk-based)
│   ├── fileAgent/           # Single-file section navigation
│   ├── queryExpansion/      # Query rewriting for better retrieval
│   ├── report/              # 4-step structured report generation
│   └── tools/               # Reusable agent tools (12+)
├── service/                 # Business logic
│   ├── simSearch.ts         # Vector similarity search (chunks, chapters, docs)
│   ├── files.ts             # File management (bulk add, status tracking)
│   ├── googleStorage.ts     # GCS operations (upload, download, signed URLs)
│   ├── citations.ts         # Citation parsing [file_ID/page=N]
│   ├── qstash.ts            # QStash task queue integration
│   ├── externalContext.ts   # Team research data (highlights, trends, scenarios)
│   ├── ingestion/           # Webhook-driven data sync from external systems
│   └── file/                # PDF parsing and metadata extraction
├── db/
│   ├── schema.ts            # 17+ tables (documents, chat, reports, analytics)
│   ├── index.ts             # Connection pooling (postgres.js + drizzle)
│   ├── queries/             # Read operations (similarity search, listings)
│   └── mutation/            # Write operations (sessions, messages, files)
├── utils/
│   ├── logger.ts            # Pino logger + OpenTelemetry log emission
│   ├── errorHandler.ts      # AppError class hierarchy + global handler
│   ├── requestContext.ts    # AsyncLocalStorage for request tracing
│   └── otel.ts              # OpenTelemetry SDK initialization
├── schemas/                 # Zod/TypeBox request/response schemas
├── config/                  # Configuration loading
└── ai-backend/              # AI integration layer (embeddings, model wrappers)

test/                        # Ad-hoc integration test scripts
drizzle/                     # SQL migrations and metadata
scripts/                     # Operational utilities
admin-dashboard/             # Separate Vite + React admin UI
```

## Authentication

### User API (Bearer Token)

All user-facing endpoints require:
- `Authorization: Bearer <BACKEND_TOKEN>` — validated against env var
- `x-user-id` — identifies the user
- `x-org-id` — identifies the organization

The auth plugin (`auth.plugin.ts`) extracts these headers, fetches team memberships from the database, and decorates `request.user` with `{id, email, name, orgId, teamIds}`.

### Admin API (JWT + TOTP 2FA)

Two-step authentication flow:
1. `POST /admin/auth/login` — password (bcrypt) → challenge token (5 min TTL)
2. `POST /admin/auth/verify-totp` — challenge + TOTP code → JWT access token (8 hour TTL)

Admin credentials are stored in an external JSON file (`admin-secrets.json`) with bcrypt password hashes and TOTP secrets.

### Webhook/Callback Auth

Callback endpoints (`/web-search-callback`, `/callbacks/parsing/:fileId`) verify QStash signatures using Upstash's signature verification.

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `user_file` | Uploaded documents — metadata, status, embeddings, parsing state |
| `file_page` | Individual parsed pages per document |
| `user_file_to_c_meta` | Table of contents, extracted metadata, page summaries |
| `file_chapter` | Chapter-level organization with summaries and embeddings |
| `file_section` | Section hierarchy (title, subsections, page ranges) |
| `file_cluster` | Page clusters with summaries |
| `hierarchical_index` | Multi-level document indexing |
| `chunks` | Vector-searchable content chunks (768-dim embeddings) |
| `chat_session` | User chat sessions |
| `messages` | Chat messages with parts (text, tool calls, tool results) |
| `web_search_task` | Background web search jobs with status tracking |
| `structured_report_template` | Report templates with custom prompts |
| `structured_reports` | Generated reports with step outputs and usage |
| `token_usage_log` | LLM token usage per operation for cost tracking |
| `text_note` | User text notes |

### External/Synced Tables

| Table | Purpose |
|-------|---------|
| `accounts` | User accounts (synced from Supabase) |
| `accounts_membership` | Organization membership |
| `highlights` | Research highlights from external app |
| `entities` | Named entities (companies, people) |
| `documents` | External document references |
| `tags`, `trends`, `scenarios` | Research metadata |

### Vector Search

Embeddings are stored as `vector(768)` columns (pgvector). Similarity search is performed via SQL using cosine distance across chunks, chapters, clusters, and documents.

## Agent Architecture

The system uses a **hub-and-spoke agent model** where the **FinAgent** is the primary orchestrator with access to 12+ specialized tools:

### Agent Hierarchy

```
FinAgent (main orchestrator)
├── fileSearchAgent      → Find relevant documents by semantic search
├── fileAnswerTool       → Extract answers from documents (TOC-based navigation)
├── chunkSearchTool      → Similarity search across text chunks
├── chapterSearchTool    → Search by chapter/section structure
├── webDocSearchTool     → Discover and ingest web documents
├── webSearchTool        → Fetch content from URLs (Firecrawl)
├── bulkFileIndexingTool → Add discovered PDFs/articles to knowledge base
├── fileStatusTool       → Monitor file processing status
├── teamContextTool      → Access team research data (highlights, trends, scenarios)
└── todoListTools        → Manage research subtasks

Standalone Agents:
├── WebAgent             → Autonomous web research (Exa + Firecrawl)
├── DeepResearch Agent   → Multi-step research (query expansion → chapter analysis)
└── StructuredReport     → 4-step report generation pipeline
```

### Permission-Gated Web Search

Web search requires explicit user permission:
1. Agent tries knowledge base first
2. If insufficient, informs the user
3. User grants permission → agent searches web
4. Agent shows discovered sources → user confirms before indexing

### Citation Format

All agent responses use inline citations: `[file_UUID/page=1,2,5]`
The citations service resolves these to file titles, URLs, and signed download links.

## Request Flow

### Typical Chat Request

```
Client POST /api/v1/chat
  ↓
Auth Plugin (validate token, extract user context)
  ↓
Logging Plugin (assign requestId, start timer)
  ↓
chatStream.routes.ts (parse body, load session)
  ↓
FinAgent (select tools, execute multi-step reasoning)
  ↓
  ├── fileSearchAgent → similarity search → rank documents
  ├── fileAnswerTool → TOC navigation → page fetching → answer extraction
  └── chunkSearchTool → vector search → content retrieval
  ↓
SSE Stream response (AI SDK streamText → client)
  ↓
Save messages to DB, update session title
```

### Async Document Processing

```
Client POST /api/v1/files/upload
  ↓
Save file to GCS, create DB record (status: "pending")
  ↓
Queue parsing job via QStash
  ↓
QStash calls POST /api/v1/callbacks/parsing/:fileId
  ↓
Parse PDF pages → Extract metadata → Generate embeddings
  ↓
Build hierarchical index (chapters → sections → chunks)
  ↓
Update file status to "completed"
```

## Observability

### Logging
- **Pino** for structured JSON logs (pretty-print in dev)
- **AsyncLocalStorage** propagates request context (requestId, userId, orgId) across async boundaries
- All responses include `X-Request-ID` header for correlation
- Slow request detection (configurable threshold, default 5s)

### Tracing
- **OpenTelemetry SDK** with auto-instrumentation (HTTP, Fastify)
- Exporters: OTLP (Jaeger, Grafana Tempo, Axiom) or Google Cloud Trace
- **Laminar AI (lmnr)** for LLM-specific tracing (agent steps, tool calls)

### Token Usage
- Per-operation token tracking stored in `token_usage_log`
- Aggregation endpoints: by model, by user, by operation
- Cost estimation per LLM provider

## Error Handling

### Error Class Hierarchy

```
AppError (base — statusCode, isOperational, context)
├── DatabaseError (500)
├── ValidationError (400)
├── ExternalAPIError (502)
├── AuthenticationError (401)
├── AuthorizationError (403)
├── NotFoundError (404)
├── RateLimitError (429)
└── TimeoutError (504)
```

### Global Error Handler
- Catches all unhandled errors at the Fastify level
- Logs with full context (userId, sessionId, path, requestId)
- Sanitizes error messages in production (hides stack traces, internal details)
- Returns structured response: `{success: false, error, requestId, details}`

### Unhandled Rejection / Uncaught Exception
- Logged with full context
- In production: graceful shutdown after uncaught exception

## Configuration

Environment variables are loaded via `dotenvx` with support for `.env`, `.env.dev`, and `.env.prod` files. Key categories:

| Category | Examples |
|----------|---------|
| **Core** | `NODE_ENV`, `PORT`, `DATABASE_URL`, `BACKEND_TOKEN` |
| **Storage** | `GCS_PROJECT_ID`, `GCS_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS` |
| **AI Providers** | `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY` |
| **Task Queue** | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `APP_URL` |
| **Admin** | `ADMIN_SECRETS_FILE`, `ADMIN_JWT_SECRET`, `ADMIN_CHALLENGE_TTL_MINUTES` |
| **Observability** | `ENABLE_OPENTELEMETRY`, `OTEL_EXPORTER_TYPE`, `AXIOM_TOKEN`, `LOG_LEVEL` |

## Build & Deployment

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Development server with hot reload (nodemon + tsx) |
| `pnpm build` | TypeScript compilation + path alias rewriting |
| `pnpm start` | Run compiled server from `dist/` |
| `pnpm lint` / `pnpm format` | Biome linting and formatting |
| `pnpm test:all` | Run integration test scripts |

### Docker

Multi-stage build:
1. **Base** — Node 20 Alpine + pnpm
2. **Builder** — Install deps, compile TypeScript
3. **Production** — Copy dist + prod deps only, expose port 3000
