/**
 * LLM-based chapter + outline generation for HTML documents. Uses the same
 * services as the PDF pipeline (generatePageSummaries + generateOutlineWithChapters)
 * so the output structure is identical across sources.
 *
 * The pipeline:
 *   1. Each page's markdown is summarised via the LITE tier model.
 *   2. The medium-tier model groups summaries into chapters (spanning ranges
 *      of pages).
 *   3. For every chapter, a section-detection pass runs against that page
 *      range, producing nested sections.
 *
 * Caching is disabled by default (one-shot request, no replay) but a custom
 * PersistenceProvider can be passed in to share summaries across requests.
 */

import crypto from "node:crypto";
import { PipelineContext } from "./context.js";
import { getModelConfig } from "./models.js";
import type { PersistenceProvider } from "./persistence.js";
import { generatePageSummaries } from "./services/cluster.js";
import { generateOutlineWithChapters, type ChapterWithSections } from "./services/outline.js";
import type { Section } from "./types.js";

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
}

export interface HtmlOutlineOptions {
  /**
   * Custom persistence for cross-request summary caching. Defaults to a no-op
   * provider (every call hits the LLM fresh).
   */
  persistence?: PersistenceProvider;
  /** Document-level summary passed to the LLM prompt. Defaults to "". */
  docSummary?: string;
}

/**
 * Generate LLM-based chapters + outline for a set of markdown pages.
 *
 * Token cost scales linearly with the number of pages (one LITE-tier summary
 * per page, plus one MEDIUM-tier chapter + one-per-chapter section pass).
 * For small docs (≤3 pages) the overhead is typically 2-3 LLM calls total.
 */
export async function generateHtmlOutline(
  pages: { pageNumber: number; content: string }[],
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

  // Step 1 — page summaries (LITE tier, batched)
  const { pageSummaries } = await generatePageSummaries(pages, ctx);

  // Step 2 — detect chapters and generate sections per chapter (MEDIUM tier)
  const result = await generateOutlineWithChapters(
    pageSummaries,
    docTitle,
    options.docSummary ?? "",
    ctx,
  );

  const chapters = result.chapters;
  // Flatten all sections across chapters for the ParsedDocument.outline field
  const outline: Section[] = chapters.flatMap((c) => c.sections);

  return { chapters, outline };
}
