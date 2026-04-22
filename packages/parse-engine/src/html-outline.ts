/**
 * LLM-based chapter + outline generation for HTML documents, with optional
 * document-level enrichment (summary + metadata). Uses the same services as
 * the PDF pipeline so the output structure is identical across sources.
 *
 * The pipeline:
 *   1. Each page's markdown is summarised via the LITE tier model.
 *   2. Two parallel branches run on the page summaries:
 *      a. Chapter + section detection (outline).
 *      b. Document-level summary + metadata (enrichment), when enabled.
 *   3. Chapter section extraction runs per-chapter after chapter detection.
 *
 * Caching is disabled by default (one-shot request, no replay) but a custom
 * PersistenceProvider can be passed in to share summaries across requests.
 */

import crypto from "node:crypto";
import { PipelineContext } from "./context.js";
import { getModelConfig } from "./models.js";
import type { PersistenceProvider } from "./persistence.js";
import { generatePageSummaries } from "./services/cluster.js";
import { enrichDocument } from "./services/enrich.js";
import { generateOutlineWithChapters, type ChapterWithSections } from "./services/outline.js";
import type { ParsedPage, Section, DocumentSummary, DocumentMetadata } from "./types.js";

/** No-op persistence provider — every cache lookup misses, every write is a noop. */
class NullPersistence implements PersistenceProvider {
  async get(): Promise<string | null> {
    return null;
  }
  async set(): Promise<void> {}
  async exists(): Promise<boolean> {
    return false;
  }
  async delete(): Promise<void> {}
}

export interface HtmlOutlineResult {
  chapters: ChapterWithSections[];
  /** Flat list of all sections across chapters (matches ParsedDocument.outline shape). */
  outline: Section[];
  /** LLM-generated document summary. Present when enrich !== false. */
  summary?: DocumentSummary;
  /** LLM-generated document metadata. Present when enrich !== false. */
  metadata?: DocumentMetadata;
}

export interface HtmlOutlineOptions {
  /**
   * Custom persistence for cross-request summary caching. Defaults to a no-op
   * provider (every call hits the LLM fresh).
   */
  persistence?: PersistenceProvider;
  /** Document-level summary passed to the LLM prompt. Defaults to "". */
  docSummary?: string;
  /**
   * Generate DocumentSummary + DocumentMetadata alongside the outline.
   * Shares the same page-summary pass as the outline so cost is just the
   * summary + metadata LLM calls. Defaults to true.
   */
  enrich?: boolean;
}

/**
 * Generate LLM-based chapters + outline (and, by default, summary + metadata)
 * for a set of markdown pages.
 *
 * Token cost scales linearly with the number of pages (one LITE-tier summary
 * per page, plus outline + enrichment passes). For small docs (≤3 pages) the
 * overhead is typically 3-4 LLM calls total.
 */
export async function generateHtmlOutline(
  pages: ParsedPage[],
  docTitle: string,
  options: HtmlOutlineOptions = {},
): Promise<HtmlOutlineResult> {
  if (pages.length === 0) return { chapters: [], outline: [] };

  // Derive a document hash from the page content so cache keys are stable
  // across repeated calls with the same input.
  const documentHash = crypto
    .createHash("md5")
    .update(pages.map((p) => p.content).join("\n---\n"))
    .digest("hex");

  const ctx = new PipelineContext({
    persistence: options.persistence ?? new NullPersistence(),
    models: getModelConfig(),
    documentHash,
  });

  // Step 1 — page summaries (LITE tier, batched). Shared downstream.
  const { pageSummaries } = await generatePageSummaries(pages, ctx);

  // Step 2 — run outline + enrichment in parallel. Both depend only on
  // pageSummaries, and failures in one shouldn't kill the other.
  const runEnrich = options.enrich !== false;
  const [outlineResult, enrichResult] = await Promise.allSettled([
    generateOutlineWithChapters(
      pageSummaries,
      docTitle,
      options.docSummary ?? "",
      ctx,
    ),
    runEnrich
      ? enrichDocument(pages, { ctx, pageSummaries, title: docTitle })
      : Promise.resolve({}),
  ]);

  let chapters: ChapterWithSections[] = [];
  let outline: Section[] = [];
  if (outlineResult.status === "fulfilled") {
    chapters = outlineResult.value.chapters;
    outline = chapters.flatMap((c) => c.sections);
  } else {
    console.error("  Outline generation failed:", (outlineResult.reason as Error)?.message);
  }

  const enrichment = enrichResult.status === "fulfilled"
    ? enrichResult.value as { summary?: DocumentSummary; metadata?: DocumentMetadata }
    : {};
  if (enrichResult.status === "rejected") {
    console.error("  Enrichment failed:", (enrichResult.reason as Error)?.message);
  }

  return {
    chapters,
    outline,
    summary: enrichment.summary,
    metadata: enrichment.metadata,
  };
}
