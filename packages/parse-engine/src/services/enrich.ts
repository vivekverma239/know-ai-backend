/**
 * enrichDocument — cross-format summary + metadata generator.
 *
 * Produces the same DocumentSummary + DocumentMetadata fields that the PDF
 * pipeline emits, from any source that provides pages (HTML, DOCX, XLSX,
 * image). Called either standalone (creates its own PipelineContext) or with
 * a caller-supplied ctx when wider pipelines want to share caching + usage.
 *
 * Inputs preferred in this order:
 *   - pageSummaries (cheapest — cluster-parsed text)
 *   - pages (full markdown, sampled to first N pages)
 * Metadata always uses pageSummaries (consistent with the PDF pipeline);
 * missing summaries are generated on demand.
 */

import crypto from "node:crypto";
import { PipelineContext } from "../context.js";
import { getModelConfig } from "../models.js";
import type { PersistenceProvider } from "../persistence.js";
import type { ParsedPage, DocumentSummary, DocumentMetadata } from "../types.js";
import { generatePageSummaries, type PageSummary } from "./cluster.js";
import { extractDocumentMetadata } from "./metadata.js";
import { getBasicSummaryFromText } from "./summary-text.js";

/** No-op persistence so standalone enrichment calls don't require an injector. */
class NullPersistence implements PersistenceProvider {
  async get(): Promise<string | null> { return null; }
  async set(): Promise<void> {}
  async exists(): Promise<boolean> { return false; }
  async delete(): Promise<void> {}
}

export interface EnrichResult {
  summary?: DocumentSummary;
  metadata?: DocumentMetadata;
  /** Included when enrichDocument had to compute them on-demand, so callers
   *  with their own outline pipeline can reuse the same page summaries. */
  pageSummaries?: PageSummary[];
}

export interface EnrichOptions {
  /** Caller-provided context. When omitted, a context with NullPersistence
   *  is created and the page-content hash is used as documentHash. */
  ctx?: PipelineContext;
  /** Pre-computed page summaries (e.g. from an outline pass). Saves a LITE
   *  batch of LLM calls when both features run in the same request. */
  pageSummaries?: PageSummary[];
  /** Persistence provider used when enrichDocument builds its own ctx. */
  persistence?: PersistenceProvider;
  /** Title hint for the summary prompt when the document has a clear title
   *  already (e.g. HTML <title>). */
  title?: string;
  /** Skip summary generation (metadata still runs). */
  skipSummary?: boolean;
  /** Skip metadata generation (summary still runs). */
  skipMetadata?: boolean;
}

function hashPages(pages: ParsedPage[]): string {
  return crypto
    .createHash("md5")
    .update(pages.map((p) => p.content).join("\n---\n"))
    .digest("hex");
}

export async function enrichDocument(
  pages: ParsedPage[],
  options: EnrichOptions = {},
): Promise<EnrichResult> {
  if (pages.length === 0) return {};

  const ctx = options.ctx ?? new PipelineContext({
    persistence: options.persistence ?? new NullPersistence(),
    models: getModelConfig(),
    documentHash: hashPages(pages),
  });

  // Metadata always needs pageSummaries; compute once and share with summary.
  let pageSummaries = options.pageSummaries;
  let computedPageSummaries = false;
  if (!pageSummaries) {
    const { pageSummaries: generated } = await generatePageSummaries(pages, ctx);
    pageSummaries = generated;
    computedPageSummaries = true;
  }

  const runSummary = !options.skipSummary;
  const runMetadata = !options.skipMetadata;

  const [summaryResult, metadataResult] = await Promise.allSettled([
    runSummary
      ? getBasicSummaryFromText({ pageSummaries, pages }, ctx, { fallbackTitle: options.title })
      : Promise.resolve(undefined),
    runMetadata
      ? extractDocumentMetadata(pageSummaries, ctx)
      : Promise.resolve(undefined),
  ]);

  if (summaryResult.status === "rejected") {
    console.error("  Summary generation failed:", (summaryResult.reason as Error)?.message);
  }
  if (metadataResult.status === "rejected") {
    console.error("  Metadata extraction failed:", (metadataResult.reason as Error)?.message);
  }

  return {
    summary: summaryResult.status === "fulfilled" ? summaryResult.value : undefined,
    metadata: metadataResult.status === "fulfilled" ? metadataResult.value : undefined,
    pageSummaries: computedPageSummaries ? pageSummaries : undefined,
  };
}
