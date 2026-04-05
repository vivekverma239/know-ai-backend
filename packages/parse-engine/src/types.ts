export interface DetectedMedia {
  pageIndex: number;
  type: "image" | "table";
  /** Normalized bounds [0-1]: [x1, y1, x2, y2] (top-left origin) */
  bounds: [number, number, number, number] | null;
  id: string;
  /** For tables: the extracted content */
  content?: string;
  /** For images: the annotation string from Mistral */
  annotation?: string;
}

export interface PageResult {
  pageIndex: number;
  markdown: string;
  images: DetectedMedia[];
  tables: DetectedMedia[];
  dimensions: { width: number; height: number; dpi: number } | null;
}

export interface SourceSummary {
  totalImages: number;
  totalTables: number;
  pagesWithMedia: number;
  pagesWithTables: number;
  pagesWithImages: number;
}

export interface EvalResult {
  totalPages: number;
  pages: PageResult[];
  summary: SourceSummary;
}

export interface ComparisonResult {
  totalPages: number;
  mistral: EvalResult;
  paddle: EvalResult | null;
  perPage: PageComparison[];
}

export interface PageComparison {
  pageIndex: number;
  mistral: { images: number; tables: number };
  paddle: { images: number; tables: number } | null;
}

// --- Full Pipeline Types (mirrors Python models) ---

/** Media block with extracted image bytes, ready for parsing */
export interface MediaBlock {
  idx: number;
  page: number;
  type: "image" | "table";
  /** Original PaddleOCR/Mistral label (e.g. "figure", "table", "image") */
  originalLabel: string;
  bounds: [number, number, number, number];
  /** Cropped region PNG bytes */
  blockBytes: Buffer;
  /** Full page PNG bytes (context for vision LLM) */
  pageBytes: Buffer;
  cacheKey: string;
}

/** Parsed media block — content extracted from the media region */
export interface ParsedMediaBlock {
  /** Placeholder reference: "Insert table/media N here" */
  referenceIdx: string;
  /** Parsed content (markdown table, chart description, etc.) */
  parsedData: string;
  page: number;
  idx: number;
  bounds: [number, number, number, number];
}

/** Final parsed page with merged content */
export interface ParsedPage {
  pageNumber: number;
  /** Markdown content with media content inlined */
  content: string;
}

// --- Outline / TOC Types ---

export interface Subsection {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
}

export interface Section {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  subsections: Subsection[];
  summary: string;
}

// --- Document Summary & Metadata Types ---

export type DocumentType =
  | "ANNUAL_REPORT"
  | "QUARTERLY_REPORT"
  | "SEC_FILING"
  | "BOND_PROSPECTUS"
  | "INVESTOR_PRESENTATION"
  | "IMF_REPORT"
  | "INTERNAL_REPORT"
  | "AUDIT_REPORT"
  | "OTHER";

export interface DocumentSummary {
  title: string;
  shortSummary: string;
  year?: number;
  date?: string;
  companies: string[];
  documentType?: DocumentType;
  sectors: string[];
}

export type Category =
  | "financial-investment-docs"
  | "macroeconomic-industry-reports"
  | "legal-corporate-regulatory"
  | "other";

export type Subcategory =
  | "financial-statements-reports"
  | "market-investment-analysis"
  | "capital-markets-debt"
  | "country-economic-research"
  | "corporate-governance-legal-structure"
  | "other";

export type Industry =
  | "technology" | "finance" | "energy" | "healthcare"
  | "consumer_goods" | "manufacturing" | "automotive"
  | "real_estate" | "consumer_services" | "materials"
  | "retail" | "other";

export interface DocumentMetadata {
  title: string;
  publicationDate?: string;
  year?: string;
  summary?: string;
  category: Category;
  subcategory: Subcategory;
  industry?: Industry;
  companies?: string[];
  country?: string;
  publisher?: string;
  documentSubtype?: string;
  /** Category-specific metadata */
  categoryMetadata?: Record<string, unknown>;
}

// --- Full Parsed Document Output ---

export interface ChapterWithSections {
  title: string;
  summary: string;
  startPage: number;
  endPage: number;
  sections: Section[];
}

export interface ParsedDocument {
  totalPages: number;
  pages: ParsedPage[];
  mediaBlocks: ParsedMediaBlock[];
  summary?: DocumentSummary;
  metadata?: DocumentMetadata;
  outline?: Section[];
  chapters?: ChapterWithSections[];
  pageSummaries?: Array<{ pageNumber: number; summary: string }>;
  usage?: import("./usage.js").PipelineUsage;
}
