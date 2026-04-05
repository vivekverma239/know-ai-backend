# Parse Engine Integration Design

**Date:** 2026-04-05
**Status:** Approved

## Goal

Replace the external PDF parsing backend (`BACKEND_URL/parse/document/async`) with a direct in-process integration of the `parse-engine` library. Parsing remains async via QStash. Old parsing code is commented out, not deleted.

## Removals

- **Hierarchical index** — remove entirely: `userFileHeirarchialIndex` table references, `GET /files/hierarchical-index` API endpoint, `updateHeirarchialIndex` function, `@types/heirarchialIndex.ts` types, and cleanup references in `documentIngestion.ts`. The DB table stays (no migration) but all code references are removed.
- **Separate ToC meta QStash job** — no longer needed. parse-engine output populates `userFileToCMeta` directly in the worker.

## Architecture

```
Upload/Webhook
  → ensureUserFileForDocument()
    → enqueueDocumentParse(fileId)       // NEW: single QStash message
      → QStash delivers to POST /api/v1/document-parse-callback
        → Download PDF buffer from GCS
        → parsePdfFromBuffer(buffer, options)
        → Map output → updateParsedPages / updateParsedMetadata / updateOutline / upsert userFileToCMeta
        → Mark file "completed"
```

**Replaces:**
- `parsePDF(fileId)` → external backend HTTP call + 4 async callbacks
- `enqueueToCMetaParsing(fileId)` → separate QStash job for ToC/meta

## Package Integration

- Copy `parse-engine` into `packages/parse-engine/` in this repo
- Add pnpm workspace config: `packages: ["packages/*"]`
- Add `"parse-engine": "workspace:*"` to root `package.json` dependencies
- parse-engine builds to `dist/` with its own tsconfig; main project imports built output
- Add `parsePdfFromBuffer(buffer, options)` export: writes buffer to temp file, calls `parsePdf()`, cleans up

## QStash Message Type

New type `document_parse` added to `QstashMessage` union in `@types/queue.ts`:

```typescript
export type DocumentParseData = { fileId: string };
```

New service function `enqueueDocumentParse(fileId)` — same pattern as `enqueueToCMetaParsing`.

## Worker Route

New route: `POST /api/v1/document-parse-callback`

1. Verify QStash signature
2. Fetch `userFile` record, resolve GCS path
3. Download PDF buffer from GCS
4. Call `parsePdfFromBuffer(buffer, { textract: true, verbose: true })`
5. Map `ParsedDocument` → call existing DB functions:
   - `updateParsedPages(fileId, mappedPages)`
   - `updateParsedMetadata(fileId, mappedMetadata)`
   - `updateOutline({ chapters, title, summary, fileId })`
   - Upsert `userFileToCMeta` with mapped ToC, metadata, and page summaries
6. Mark status `completed`
7. On error: mark status `failed`, log error

## Mapper Layer

New file: `src/service/file/parseEngineMapper.ts`

### Pages
- parse-engine `ParsedPage[]` (0-indexed) → existing `ParsedPDF` (1-indexed)
- Shift `pageNumber + 1`

### Metadata
- parse-engine `DocumentSummary` + `DocumentMetadata` + `pageSummaries` → existing `DocumentMetadata` callback type
- `summary.title` → `document_metadata.title`
- `summary.shortSummary` → `document_metadata.short_summary`
- `summary.companies` → `Company[]` (name only, other fields empty arrays)
- `metadata.industry` → `document_metadata.industry`
- `metadata.category` → `document_metadata.document_type`
- Clusters derived by grouping consecutive page summaries (~10 pages per cluster)

### Outline
- parse-engine `ChapterWithSections[]` → existing `Chapter[]`
- `startPage` → `start_page` (+ 1 for 1-indexing)
- `sections[].subsections[]` → `SubsectionAPI` format (`subsection_summary` field name)

### ToC Meta (replaces separate parseToCMeta agent)
- parse-engine `ChapterWithSections[]` → `TocSection[]` format (`{ title, pageStart, pageEnd, summary, subsections[] }`)
- parse-engine `pageSummaries` → `ChunkPageSummary[]` format (`{ pageNumber, summary, keyPoints: [] }`)
- parse-engine `DocumentSummary` + `DocumentMetadata` → `DocumentMetadata` (parseToCMeta format: `{ title, shortSummary, summary, publishedDate }`)
- Page numbers shifted +1 for 1-indexing

## parse-engine Changes

1. Add `parsePdfFromBuffer(buffer: Buffer, options: PipelineOptions)` export
2. Add `pageSummaries: PageSummary[]` to `ParsedDocument` output type
3. Export `PageSummary` type from index

## Integration Point

In `documentIngestion.ts`, the PDF branch changes from:

```typescript
await parsePDF(fileId);              // commented out
await enqueueToCMetaParsing(fileId); // commented out
await enqueueDocumentParse(fileId);  // new
```

Old code is commented, not deleted. Old callback routes (`parsingCallback.routes.ts`, `tocMetaCallback.routes.ts`) stay registered but receive no new traffic.

## Environment Variables

New (user manages these):
- `MISTRAL_API_KEY` — required for Mistral OCR
- `AI_GATEWAY_API_KEY` — required for LLM media/outline/metadata parsing
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — for Textract table parsing

Already present:
- `GOOGLE_STORAGE_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS`

Optional overrides:
- `MODEL_LITE`, `MODEL_MEDIUM`, `MODEL_SMART`

## Docker / Build

- Install system deps for `mupdf` and `sharp` if needed (npm binaries may handle this)
- `pnpm install` pulls parse-engine workspace deps
- Build step: `pnpm --filter parse-engine build` before `tsc && tsc-alias`

## Files to Create/Modify

### New Files
- `packages/parse-engine/` — copied from lara-ai repo
- `src/service/file/parseEngineMapper.ts` — type mapping layer
- `src/service/file/enqueueDocumentParse.ts` — QStash enqueue function
- `src/routes/documentParseCallback.routes.ts` — QStash worker route
- `pnpm-workspace.yaml` — workspace config

### Modified Files
- `packages/parse-engine/src/parse.ts` — add `parsePdfFromBuffer`
- `packages/parse-engine/src/index.ts` — export new function + `PageSummary` on `ParsedDocument`
- `packages/parse-engine/src/types.ts` — add `pageSummaries` to `ParsedDocument`
- `src/@types/queue.ts` — add `document_parse` type
- `src/service/ingestion/documentIngestion.ts` — swap to `enqueueDocumentParse`
- `src/server.ts` — register new route
- `package.json` — add `parse-engine` workspace dep
- `Dockerfile` — build parse-engine, install native deps if needed

### Removed (hierarchical index)
- `src/routes/file.routes.ts` — remove `GET /hierarchical-index` endpoint + delete handler references
- `src/service/file/parsing.ts` — remove `updateHeirarchialIndex` function
- `src/service/ingestion/documentIngestion.ts` — remove `userFileHeirarchialIndex` cleanup in dedup
- `src/routes/parsingCallback.routes.ts` — remove `parse_heirarchial_index` handler
- `src/@types/heirarchialIndex.ts` — remove file (or leave as dead code)

### Preserved (commented out, not deleted)
- `src/service/file/triggerParsing.ts` — `parsePDF()` function
- `src/service/tocMetaQueue.ts` — `enqueueToCMetaParsing()` function
- `src/routes/parsingCallback.routes.ts` — callback dispatcher (kept registered, no new traffic)
- `src/routes/tocMetaCallback.routes.ts` — ToC meta callback (kept registered, no new traffic)
