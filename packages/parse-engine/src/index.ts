/**
 * parse-engine — Document parsing pipeline.
 *
 * Usage:
 *   import { parsePdf, PipelineContext, LocalPersistence } from "parse-engine";
 *
 *   const result = await parsePdf("/path/to/doc.pdf", {
 *     persistence: new LocalPersistence(".cache"),
 *     models: { lite: "google/gemini-2.5-flash-lite", medium: "google/gemini-2.5-flash", smart: "google/gemini-3-flash" },
 *   });
 */

// Core pipeline
export { parsePdf, parsePdfFromBuffer, type PipelineOptions } from "./parse.js";

// Context & config
export { PipelineContext, type PipelineConfig } from "./context.js";
export { getModelConfig, type ModelConfig } from "./models.js";
export { getGateway, getGatewayModel } from "./ai.js";

// Persistence
export { type PersistenceProvider, LocalPersistence, fileHash } from "./persistence.js";

// Usage tracking
export { UsageTracker, type PipelineUsage, type StepUsage, type TokenUsage } from "./usage.js";

// Types
export type {
  ParsedDocument,
  ParsedPage,
  ParsedMediaBlock,
  DetectedMedia,
  MediaBlock,
  PageResult,
  DocumentSummary,
  DocumentMetadata,
  Section,
  Subsection,
  ChapterWithSections,
} from "./types.js";

// Individual services (for advanced usage)
export { parseChart, parseTableWithLLM } from "./services/chart.js";
export { parseTableWithTextract } from "./services/textract.js";
export { parseMediaBlocks } from "./services/media.js";
export { placeMediaBlocks } from "./services/placement.js";
export { getBasicSummary } from "./services/summary.js";
export { generatePageSummaries } from "./services/cluster.js";
export { generateOutlineWithChapters, detectChapters, generateOutline } from "./services/outline.js";
export { extractDocumentMetadata } from "./services/metadata.js";

// PDF utilities
export { PdfDocument } from "./pdf.js";
export { runMistralOCR, runMistralOCRChunked } from "./mistral.js";
export { withRetry, type RetryOptions } from "./retry.js";
