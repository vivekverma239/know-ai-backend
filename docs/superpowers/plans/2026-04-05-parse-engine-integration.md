# Parse Engine Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the external PDF parsing backend with the in-process `parse-engine` library, dispatched via QStash.

**Architecture:** A single QStash message (`document_parse`) triggers a worker that downloads the PDF from GCS, calls `parsePdfFromBuffer()`, maps the output to the existing DB schema via a mapper layer, and writes pages/metadata/outline/ToC in one shot. The hierarchical index feature is removed entirely.

**Tech Stack:** TypeScript, Fastify, QStash (Upstash), parse-engine (Mistral OCR + Textract + Vercel AI SDK), Drizzle ORM, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-04-05-parse-engine-integration-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `packages/parse-engine/` | Copied from lara-ai repo (entire directory) |
| `pnpm-workspace.yaml` | pnpm workspace config |
| `src/service/file/parseEngineMapper.ts` | Maps parse-engine output → existing DB types |
| `src/service/file/enqueueDocumentParse.ts` | Publishes `document_parse` QStash message |
| `src/routes/documentParseCallback.routes.ts` | QStash worker route — runs parse-engine + saves to DB |

### Modified Files
| File | Change |
|------|--------|
| `packages/parse-engine/src/parse.ts` | Add `parsePdfFromBuffer()` |
| `packages/parse-engine/src/types.ts` | Add `pageSummaries` to `ParsedDocument` |
| `packages/parse-engine/src/index.ts` | Export new function + types |
| `package.json` | Add `parse-engine` workspace dep |
| `src/@types/queue.ts` | Add `document_parse` message type |
| `src/service/ingestion/documentIngestion.ts` | Swap to `enqueueDocumentParse`, comment out old calls |
| `src/server.ts` | Register new route |
| `src/routes/file.routes.ts` | Remove hierarchical index endpoint + delete handler cleanup |
| `src/schemas/file.schema.ts` | Remove `HierarchicalIndexItems` |
| `src/service/file/parsing.ts` | Remove `updateHeirarchialIndex`, remove hierarchical index from `updateStatus` |
| `src/routes/parsingCallback.routes.ts` | Remove `parse_heirarchial_index` handler branch |

---

### Task 1: Copy parse-engine Package + Workspace Setup

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `packages/parse-engine/` (copy from `/Users/vivekverma/Toptal/NumenCapital/lara-ai/backend_v2/parse-engine`)
- Modify: `package.json`

- [ ] **Step 1: Create pnpm workspace config**

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Copy parse-engine into packages/**

```bash
mkdir -p packages
cp -r /Users/vivekverma/Toptal/NumenCapital/lara-ai/backend_v2/parse-engine packages/parse-engine
rm -rf packages/parse-engine/node_modules packages/parse-engine/dist packages/parse-engine/.cache
```

- [ ] **Step 3: Add parse-engine as workspace dependency**

In `package.json`, add to `"dependencies"`:
```json
"parse-engine": "workspace:*"
```

- [ ] **Step 4: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 5: Build parse-engine**

```bash
pnpm --filter parse-engine build
```

Verify `packages/parse-engine/dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml packages/parse-engine package.json pnpm-lock.yaml
git commit -m "feat: add parse-engine as workspace package"
```

---

### Task 2: Add `parsePdfFromBuffer` to parse-engine

**Files:**
- Modify: `packages/parse-engine/src/parse.ts`
- Modify: `packages/parse-engine/src/types.ts`
- Modify: `packages/parse-engine/src/index.ts`

- [ ] **Step 1: Add `pageSummaries` to `ParsedDocument` in `types.ts`**

In `packages/parse-engine/src/types.ts`, add to the `ParsedDocument` interface:

```typescript
export interface ParsedDocument {
  totalPages: number;
  pages: ParsedPage[];
  mediaBlocks: ParsedMediaBlock[];
  summary?: DocumentSummary;
  metadata?: DocumentMetadata;
  outline?: Section[];
  chapters?: ChapterWithSections[];
  pageSummaries?: Array<{ pageNumber: number; summary: string }>; // NEW
  usage?: import("./usage.js").PipelineUsage;
}
```

- [ ] **Step 2: Return `pageSummaries` from `parsePdf` in `parse.ts`**

In `packages/parse-engine/src/parse.ts`, after the cluster parsing step (`generatePageSummaries`), include `pageSummaries` in the return value. Find the final `return` block (around line 250) and add `pageSummaries`:

Replace the return block:
```typescript
    return {
      totalPages: mistralResult.totalPages,
      pages: mergedPages,
      mediaBlocks: parsedBlocks,
      summary,
      metadata,
      outline,
      chapters,
      usage: ctx.usage.getReport(),
    };
```

With:
```typescript
    return {
      totalPages: mistralResult.totalPages,
      pages: mergedPages,
      mediaBlocks: parsedBlocks,
      summary,
      metadata,
      outline,
      chapters,
      pageSummaries: clusterResult.pageSummaries,
      usage: ctx.usage.getReport(),
    };
```

- [ ] **Step 3: Add `parsePdfFromBuffer` function in `parse.ts`**

Append to the end of `packages/parse-engine/src/parse.ts`:

```typescript
/**
 * Parse a PDF from an in-memory buffer.
 * Writes to a temp file, delegates to parsePdf, then cleans up.
 */
export async function parsePdfFromBuffer(
  buffer: Buffer,
  options: PipelineOptions = {},
): Promise<ParsedDocument> {
  const workDir = options.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "parse-engine-buf-"));
  const tempPath = path.join(workDir, "document.pdf");
  fs.writeFileSync(tempPath, buffer);

  try {
    return await parsePdf(tempPath, { ...options, workDir });
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Export new function and type from `index.ts`**

In `packages/parse-engine/src/index.ts`, add the export for `parsePdfFromBuffer`:

Replace the existing core pipeline export line:
```typescript
export { parsePdf, type PipelineOptions } from "./parse.js";
```

With:
```typescript
export { parsePdf, parsePdfFromBuffer, type PipelineOptions } from "./parse.js";
```

- [ ] **Step 5: Rebuild parse-engine**

```bash
pnpm --filter parse-engine build
```

Verify no build errors.

- [ ] **Step 6: Commit**

```bash
git add packages/parse-engine/src/parse.ts packages/parse-engine/src/types.ts packages/parse-engine/src/index.ts
git commit -m "feat(parse-engine): add parsePdfFromBuffer and expose pageSummaries"
```

---

### Task 3: Remove Hierarchical Index

**Files:**
- Modify: `src/routes/file.routes.ts`
- Modify: `src/schemas/file.schema.ts`
- Modify: `src/service/file/parsing.ts`
- Modify: `src/routes/parsingCallback.routes.ts`
- Modify: `src/service/ingestion/documentIngestion.ts`

- [ ] **Step 1: Remove hierarchical index endpoint from `file.routes.ts`**

In `src/routes/file.routes.ts`:

Remove `userFileHeirarchialIndex` from the import on line 12:
```typescript
// BEFORE
import {
  type UserFileStatus,
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFileHeirarchialIndex,
  userFilePage,
  userFileSection,
} from "../db/schema";
```
```typescript
// AFTER
import {
  type UserFileStatus,
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFilePage,
  userFileSection,
} from "../db/schema";
```

Remove the `HierarchicalIndexItems` import from the schema import (line 23):
```typescript
// BEFORE
import {
  DeleteResponse,
  FilePagesResponse,
  FileSectionsResponse,
  FileUploadRequest,
  FileUploadResponse,
  HierarchicalIndexItems,
  SignedUrlResponse,
  UserFileSchema,
  UserFileWithMetaSchema,
} from "../schemas/file.schema";
```
```typescript
// AFTER
import {
  DeleteResponse,
  FilePagesResponse,
  FileSectionsResponse,
  FileUploadRequest,
  FileUploadResponse,
  SignedUrlResponse,
  UserFileSchema,
  UserFileWithMetaSchema,
} from "../schemas/file.schema";
```

Remove the entire `GET /hierarchical-index` route block (lines 364-421 — from the comment `// Get hierarchical index` to the closing `});` before `// Delete file`).

In the delete handler, remove the hierarchical index cleanup (lines 475-477):
```typescript
// REMOVE these lines:
      await getDb()
        .delete(userFileHeirarchialIndex)
        .where(eq(userFileHeirarchialIndex.fileId, id));
```

- [ ] **Step 2: Remove `HierarchicalIndexItems` schema from `file.schema.ts`**

In `src/schemas/file.schema.ts`, remove lines 51-63:
```typescript
// REMOVE:
export const HierarchicalIndexItems = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.String(),
      fileId: Type.String(),
      title: Type.String(),
      summary: Type.String(),
      level: Type.Number(),
      startPage: Type.Number(),
      endPage: Type.Number(),
    }),
  ),
});
```

- [ ] **Step 3: Remove `updateHeirarchialIndex` from `parsing.ts`**

In `src/service/file/parsing.ts`:

Remove the import of `HeirarchialIndexData` (line 2):
```typescript
// REMOVE:
import type { HeirarchialIndexData } from "@/@types/heirarchialIndex";
```

Remove `userFileHeirarchialIndex` from the schema import (line 12):
```typescript
// BEFORE
import {
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFileHeirarchialIndex,
  userFilePage,
  userFileSection,
} from "@/db/schema";
```
```typescript
// AFTER
import {
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFilePage,
  userFileSection,
} from "@/db/schema";
```

Remove the entire `updateHeirarchialIndex` function (lines 416-498).

- [ ] **Step 4: Remove hierarchical index callback from `parsingCallback.routes.ts`**

In `src/routes/parsingCallback.routes.ts`:

Remove the `HeirarchialIndexData` import (line 1):
```typescript
// REMOVE:
import type { HeirarchialIndexData } from "@/@types/heirarchialIndex";
```

Remove `updateHeirarchialIndex` from the import (line 10):
```typescript
// BEFORE
import {
  updateHeirarchialIndex,
  updateOutline,
  updateParsedMetadata,
  updateParsedPages,
} from "@/service/file/parsing";
```
```typescript
// AFTER
import {
  updateOutline,
  updateParsedMetadata,
  updateParsedPages,
} from "@/service/file/parsing";
```

Remove `HeirarchialIndexData` from the type union on line 63:
```typescript
// BEFORE
          data: HeirarchialIndexData | ParsedPDF | DocumentMetadata | SectionCallbackData;
```
```typescript
// AFTER
          data: ParsedPDF | DocumentMetadata | SectionCallbackData;
```

Remove the `parse_heirarchial_index` handler branch (lines 76-77):
```typescript
// REMOVE:
        if (task_type === "parse_heirarchial_index") {
          await updateHeirarchialIndex(fileId, data as HeirarchialIndexData);
        } else if (task_type === "parse_outline") {
```
Replace with:
```typescript
        if (task_type === "parse_outline") {
```

- [ ] **Step 5: Remove hierarchical index cleanup from `documentIngestion.ts`**

In `src/service/ingestion/documentIngestion.ts`:

Remove `userFileHeirarchialIndex` from the import (line 8):
```typescript
// BEFORE
import {
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFileHeirarchialIndex,
  userFilePage,
  userFileSection,
  userFileToCMeta,
} from "@/db/schema";
```
```typescript
// AFTER
import {
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFilePage,
  userFileSection,
  userFileToCMeta,
} from "@/db/schema";
```

Remove the hierarchical index cleanup in the dedup block (lines 173-174):
```typescript
// REMOVE:
      await tx
        .delete(userFileHeirarchialIndex)
        .where(inArray(userFileHeirarchialIndex.fileId, duplicateIds));
```

- [ ] **Step 6: Verify build**

```bash
pnpm run build
```

Should compile with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/file.routes.ts src/schemas/file.schema.ts src/service/file/parsing.ts src/routes/parsingCallback.routes.ts src/service/ingestion/documentIngestion.ts
git commit -m "refactor: remove hierarchical index feature"
```

---

### Task 4: Add QStash Message Type + Enqueue Function

**Files:**
- Modify: `src/@types/queue.ts`
- Create: `src/service/file/enqueueDocumentParse.ts`

- [ ] **Step 1: Add `document_parse` message type to `queue.ts`**

In `src/@types/queue.ts`, add the new data type and update the union:

```typescript
export type FileProcessingData = {
  fileId: string;
};

export type WebSearchProcessingData = {
  taskId: string;
};

export type ToCMetaProcessingData = {
  fileId: string;
};

export type ReportContinuationData = {
  reportId: string;
};

export type DocumentParseData = {
  fileId: string;
};

export type QstashMessage<T> = {
  type:
    | "file_processing"
    | "web_search_processing"
    | "structured_report_processing"
    | "toc_meta_processing"
    | "report_continuation"
    | "document_parse";
  data: T;
};
```

- [ ] **Step 2: Create `enqueueDocumentParse.ts`**

Create `src/service/file/enqueueDocumentParse.ts`:

```typescript
import type { DocumentParseData } from "@/@types/queue";
import { logger } from "@/utils/logger";
import { sendQstashMessage } from "../qstash";

export const enqueueDocumentParse = async (fileId: string): Promise<void> => {
  try {
    await sendQstashMessage<DocumentParseData>("api/v1/document-parse-callback", {
      type: "document_parse",
      data: { fileId },
    });
    logger.info("Enqueued document parse", { fileId });
  } catch (error) {
    logger.error("Failed to enqueue document parse", {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
```

- [ ] **Step 3: Verify build**

```bash
pnpm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/@types/queue.ts src/service/file/enqueueDocumentParse.ts
git commit -m "feat: add document_parse QStash message type and enqueue function"
```

---

### Task 5: Create Mapper Layer

**Files:**
- Create: `src/service/file/parseEngineMapper.ts`

This file maps parse-engine's `ParsedDocument` output to the existing DB types used by `updateParsedPages`, `updateParsedMetadata`, `updateOutline`, and `userFileToCMeta`.

- [ ] **Step 1: Create the mapper file**

Create `src/service/file/parseEngineMapper.ts`:

```typescript
import type { Chapter, Section as DBSection, SubsectionAPI } from "@/@types/fileIndex";
import type { DocumentMetadata as MetadataCallback } from "@/@types/metadata";
import type { ParsedPDF } from "@/@types/parsedData";
import type {
  ParsedDocument,
  ChapterWithSections,
  DocumentSummary,
  DocumentMetadata as PEDocumentMetadata,
  Section as PESection,
} from "parse-engine";
import type { Toc, TocSection, DocumentMetadata as ToCDocMetadata } from "@/agents/document/parseToCMeta";

/**
 * Shift a 0-indexed page number to 1-indexed.
 */
const toOneBased = (page: number): number => page + 1;

/**
 * Map parse-engine pages to existing ParsedPDF format.
 */
export function mapPages(result: ParsedDocument): ParsedPDF {
  return {
    title: result.summary?.title ?? "",
    summary: {
      title: result.summary?.title ?? "",
      short_summary: result.summary?.shortSummary ?? "",
      year: result.summary?.year ?? 0,
      date: result.summary?.date ?? "",
      companies: result.summary?.companies ?? [],
      document_type: result.summary?.documentType ?? "OTHER",
    },
    metadata: {
      title: result.metadata?.title ?? result.summary?.title ?? "",
      publication_date: result.metadata?.publicationDate ?? "",
      year: result.metadata?.year ?? "",
      summary: result.metadata?.summary ?? "",
      category: result.metadata?.category ?? "other",
      subcategory: result.metadata?.subcategory ?? "other",
      id: "",
    },
    pages: result.pages.map((p) => ({
      page_number: toOneBased(p.pageNumber),
      content: p.content,
      page_images: [],
    })),
    chart_blocks: result.mediaBlocks.map((mb) => ({
      reference_idx: mb.referenceIdx,
      parsed_data: mb.parsedData,
      page: toOneBased(mb.page),
      idx: mb.idx,
      bounds: mb.bounds as number[],
    })),
  };
}

/**
 * Map parse-engine output to existing DocumentMetadata (callback format) for updateParsedMetadata.
 */
export function mapMetadata(result: ParsedDocument): MetadataCallback {
  const pageSummaries = (result.pageSummaries ?? []).map((ps) => ({
    page_number: toOneBased(ps.pageNumber),
    summary: ps.summary,
  }));

  // Derive clusters by grouping consecutive page summaries (~10 pages per cluster)
  const clusterSize = 10;
  const clusters = [];
  for (let i = 0; i < pageSummaries.length; i += clusterSize) {
    const batch = pageSummaries.slice(i, i + clusterSize);
    const startPage = batch[0].page_number;
    const endPage = batch[batch.length - 1].page_number;
    const clusterSummary = batch.map((p) => p.summary).join(" ");
    clusters.push({
      start_page: startPage,
      end_page: endPage,
      cluster_summary: clusterSummary.slice(0, 500),
    });
  }

  return {
    clusters,
    total_pages: result.totalPages,
    page_summaries: pageSummaries,
    document_metadata: {
      document_type: result.metadata?.category ?? result.summary?.documentType ?? "OTHER",
      document_published_date: result.metadata?.publicationDate,
      industry: result.metadata?.industry ?? "other",
      summary: result.metadata?.summary ?? result.summary?.shortSummary ?? "",
      short_summary: result.summary?.shortSummary ?? "",
      title: result.summary?.title ?? result.metadata?.title ?? "",
      entities: result.summary?.companies ?? [],
      reference_period: undefined,
      reference_period_end_date: undefined,
      companies: (result.summary?.companies ?? []).map((name) => ({
        name,
        countries: [],
        industry: [],
        products_or_services: [],
        customers: [],
        suppliers: [],
      })),
      published_year: result.summary?.year ?? 0,
    },
    usage_metadata: {},
  };
}

/**
 * Map parse-engine chapters to existing Chapter[] format for updateOutline.
 */
export function mapOutline(result: ParsedDocument): {
  chapters: Chapter[];
  title: string;
  summary: string;
} {
  const chapters: Chapter[] = (result.chapters ?? []).map((ch) => ({
    title: ch.title,
    summary: ch.summary,
    start_page: toOneBased(ch.startPage),
    end_page: toOneBased(ch.endPage),
    sections: ch.sections.map((sec): DBSection => ({
      id: sec.id,
      title: sec.title,
      start_page: toOneBased(sec.startPage),
      end_page: toOneBased(sec.endPage),
      section_summary: sec.summary,
      subsections: sec.subsections.map((sub): SubsectionAPI => ({
        id: sub.id,
        title: sub.title,
        start_page: toOneBased(sub.startPage),
        end_page: toOneBased(sub.endPage),
        subsection_summary: sub.summary,
      })),
    })),
  }));

  return {
    chapters,
    title: result.summary?.title ?? "",
    summary: result.summary?.shortSummary ?? "",
  };
}

/**
 * Map parse-engine output to userFileToCMeta format (replaces separate parseToCMeta agent).
 */
export function mapToCMeta(result: ParsedDocument): {
  toc: Toc;
  metadata: ToCDocMetadata;
  pages: Array<{ pageNumber: number; summary: string; keyPoints: string[] }>;
} {
  // Map chapters → TocSection format
  const sections: TocSection[] = (result.chapters ?? []).map((ch) => ({
    title: ch.title,
    pageStart: toOneBased(ch.startPage),
    pageEnd: toOneBased(ch.endPage),
    summary: ch.summary,
    subsections: ch.sections.map((sec) => ({
      title: sec.title,
      pageStart: toOneBased(sec.startPage),
      pageEnd: toOneBased(sec.endPage),
      summary: sec.summary,
    })),
  }));

  const metadata: ToCDocMetadata = {
    title: result.summary?.title ?? result.metadata?.title ?? "",
    shortSummary: result.summary?.shortSummary ?? "",
    summary: result.metadata?.summary ?? result.summary?.shortSummary ?? "",
    publishedDate: result.metadata?.publicationDate,
  };

  const pages = (result.pageSummaries ?? []).map((ps) => ({
    pageNumber: toOneBased(ps.pageNumber),
    summary: ps.summary,
    keyPoints: [] as string[],
  }));

  return {
    toc: { sections },
    metadata,
    pages,
  };
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/service/file/parseEngineMapper.ts
git commit -m "feat: add parse-engine to DB type mapper layer"
```

---

### Task 6: Create Worker Route

**Files:**
- Create: `src/routes/documentParseCallback.routes.ts`

- [ ] **Step 1: Create the route file**

Create `src/routes/documentParseCallback.routes.ts`:

```typescript
import { getDb } from "@/db";
import { userFile, userFileToCMeta } from "@/db/schema";
import { mapMetadata, mapOutline, mapPages, mapToCMeta } from "@/service/file/parseEngineMapper";
import { updateOutline, updateParsedMetadata, updateParsedPages } from "@/service/file/parsing";
import { resolveExistingPdfStoragePath } from "@/service/file/storagePath";
import { getStorage } from "@/service/googleStorage";
import { logError, logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import { Receiver } from "@upstash/qstash";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { parsePdfFromBuffer } from "parse-engine";

const documentParseCallbackRoutes = async (fastify: FastifyInstance) => {
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  });

  fastify.post(
    "/",
    {
      config: {
        rawBody: true,
      },
      schema: {
        description: "QStash callback for document parsing via parse-engine",
        tags: ["Callbacks"],
        headers: Type.Object({
          "upstash-signature": Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          400: Type.Object({ success: Type.Boolean(), error: Type.Optional(Type.String()) }),
          500: Type.Object({ success: Type.Boolean(), error: Type.Optional(Type.String()) }),
        },
      },
    },
    async (request, reply) => {
      let fileId: string | undefined;
      try {
        // Verify QStash signature
        const signature = (request.headers["upstash-signature"] ??
          request.headers["Upstash-Signature"]) as string | undefined;
        if (!signature) {
          logger.warn("Document parse callback: No signature provided");
          return reply.code(400).send({ success: false });
        }

        const bodyText =
          typeof request.rawBody === "string"
            ? request.rawBody
            : typeof request.body === "string"
              ? request.body
              : JSON.stringify(request.body ?? {});

        try {
          const isValid = await receiver.verify({ body: bodyText, signature });
          if (!isValid) {
            logger.warn("Document parse callback: Invalid signature");
            return reply.code(400).send({ success: false });
          }
        } catch (err) {
          logger.error("Document parse callback: Error verifying signature", {
            error: err instanceof Error ? err.message : String(err),
          });
          return reply.code(400).send({ success: false });
        }

        const { type, data } = JSON.parse(bodyText) as {
          type: string;
          data: { fileId?: string };
        };

        if (type !== "document_parse") {
          logger.warn("Document parse callback: Invalid message type", { type });
          return reply.code(400).send({ success: false });
        }

        fileId = data?.fileId;
        if (!fileId || typeof fileId !== "string") {
          logger.warn("Document parse callback: Invalid or missing fileId", { fileId });
          return reply.code(400).send({ success: false });
        }

        logger.info("Starting document parse via parse-engine", { fileId });

        // Update status to in_progress
        await getDb().update(userFile).set({ status: "in_progress" }).where(eq(userFile.id, fileId));

        // Fetch file record
        const file = await getDb().query.userFile.findFirst({
          where: eq(userFile.id, fileId),
        });
        if (!file) {
          throw new Error(`File not found: ${fileId}`);
        }

        // Download PDF from GCS
        const storage = getStorage();
        const gcsPath = await resolveExistingPdfStoragePath(storage, {
          id: fileId,
          userId: file.userId,
          orgId: file.orgId,
          isAdminFile: file.isAdminFile,
        });
        if (!gcsPath) {
          throw new Error(`PDF file not found in storage for file ${fileId}`);
        }
        const pdfBuffer = await storage.downloadFile(gcsPath);

        logger.info("PDF downloaded, starting parse-engine", { fileId, bufferSize: pdfBuffer.length });

        // Run parse-engine
        const result = await parsePdfFromBuffer(pdfBuffer, {
          textract: true,
          verbose: true,
        });

        logger.info("parse-engine completed", {
          fileId,
          totalPages: result.totalPages,
          chaptersCount: result.chapters?.length ?? 0,
          hasMetadata: !!result.metadata,
          hasSummary: !!result.summary,
        });

        // Map and save pages
        const mappedPages = mapPages(result);
        await updateParsedPages(fileId, mappedPages);
        logger.info("Pages saved", { fileId, pageCount: mappedPages.pages.length });

        // Map and save metadata (clusters + document metadata)
        const mappedMetadata = mapMetadata(result);
        await updateParsedMetadata(fileId, mappedMetadata);
        logger.info("Metadata saved", { fileId });

        // Map and save outline (chapters + sections)
        if (result.chapters && result.chapters.length > 0) {
          const mappedOutline = mapOutline(result);
          await updateOutline({
            chapters: mappedOutline.chapters,
            title: mappedOutline.title,
            summary: mappedOutline.summary,
            fileId,
          });
          logger.info("Outline saved", { fileId, chapterCount: mappedOutline.chapters.length });
        }

        // Map and save ToC meta (replaces separate parseToCMeta agent)
        const mappedToCMeta = mapToCMeta(result);
        await getDb()
          .insert(userFileToCMeta)
          .values({
            fileId,
            toc: mappedToCMeta.toc,
            metadata: mappedToCMeta.metadata,
            pages: mappedToCMeta.pages,
            tokenUsage: null,
          })
          .onConflictDoUpdate({
            target: userFileToCMeta.fileId,
            set: {
              toc: mappedToCMeta.toc,
              metadata: mappedToCMeta.metadata,
              pages: mappedToCMeta.pages,
              tokenUsage: null,
            },
          });
        logger.info("ToC meta saved", { fileId });

        // Mark completed
        await getDb().update(userFile).set({ status: "completed" }).where(eq(userFile.id, fileId));
        logger.info("Document parse completed successfully", { fileId });

        return reply.send({ success: true });
      } catch (error) {
        logError(error, { operation: "documentParseCallback", fileId });
        if (fileId) {
          try {
            await getDb().update(userFile).set({ status: "failed" }).where(eq(userFile.id, fileId));
          } catch { /* ignore status update failure */ }
        }
        return reply.code(500).send({ success: false });
      }
    },
  );
};

export default documentParseCallbackRoutes;
```

- [ ] **Step 2: Verify build**

```bash
pnpm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/documentParseCallback.routes.ts
git commit -m "feat: add document parse QStash worker route"
```

---

### Task 7: Register Route + Swap Ingestion Logic

**Files:**
- Modify: `src/server.ts`
- Modify: `src/service/ingestion/documentIngestion.ts`

- [ ] **Step 1: Register the new route in `server.ts`**

In `src/server.ts`, add the import at the top with the other route imports:

```typescript
import documentParseCallbackRoutes from "./routes/documentParseCallback.routes";
```

Add the route registration after the `tocMetaCallbackRoutes` line (around line 136):

```typescript
  await fastify.register(documentParseCallbackRoutes, {
    prefix: "/api/v1/document-parse-callback",
  });
```

- [ ] **Step 2: Swap the parsing calls in `documentIngestion.ts`**

In `src/service/ingestion/documentIngestion.ts`:

Replace the import of `parsePDF` (line 15):
```typescript
// BEFORE
import { parsePDF } from "../file/triggerParsing";
```
```typescript
// AFTER
// import { parsePDF } from "../file/triggerParsing"; // OLD: external backend
import { enqueueDocumentParse } from "../file/enqueueDocumentParse";
```

Replace the import of `enqueueToCMetaParsing` (line 17):
```typescript
// BEFORE
import { enqueueToCMetaParsing } from "../tocMetaQueue";
```
```typescript
// AFTER
// import { enqueueToCMetaParsing } from "../tocMetaQueue"; // OLD: separate ToC meta job
```

Replace the PDF processing calls (lines 283-284):
```typescript
// BEFORE
      await parsePDF(fileId);
      await enqueueToCMetaParsing(fileId);
```
```typescript
// AFTER
      // await parsePDF(fileId); // OLD: external backend
      // await enqueueToCMetaParsing(fileId); // OLD: separate ToC meta job
      await enqueueDocumentParse(fileId);
```

- [ ] **Step 3: Verify build**

```bash
pnpm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/service/ingestion/documentIngestion.ts
git commit -m "feat: wire up parse-engine integration — swap ingestion to enqueueDocumentParse"
```

---

### Task 8: Verify End-to-End + Rebuild parse-engine

**Files:** None (verification only)

- [ ] **Step 1: Full build**

```bash
pnpm --filter parse-engine build && pnpm run build
```

Both must succeed with no errors.

- [ ] **Step 2: Run existing tests**

```bash
pnpm run test
```

Verify no regressions from the hierarchical index removal or import changes.

- [ ] **Step 3: Verify lint**

```bash
pnpm run lint
```

Fix any lint issues.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: lint fixes for parse-engine integration"
```
