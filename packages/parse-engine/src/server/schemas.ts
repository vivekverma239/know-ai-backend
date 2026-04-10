import { z } from "zod";

// -- Shared --

export const ErrorResponse = z.object({
  error: z.string(),
});

// -- Health --

export const HealthResponse = z.object({
  status: z.enum(["ok"]),
  timestamp: z.string().datetime(),
});

// -- Parse --

export const ParseResponse = z.object({
  jobId: z.string().uuid(),
  status: z.literal("processing"),
});

export const ParseQuerySchema = z.object({
  paddle: z.coerce.boolean().optional().default(false),
  textract: z.coerce.boolean().optional().default(false),
});

// -- Job Result --

export const JobStatus = z.enum(["processing", "completed", "failed", "not_found"]);

const ParsedPageSchema = z.object({
  pageNumber: z.number(),
  content: z.string(),
});

const ParsedMediaBlockSchema = z.object({
  referenceIdx: z.string(),
  parsedData: z.string(),
  page: z.number(),
  idx: z.number(),
  bounds: z.array(z.number()),
});

const SubsectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  summary: z.string(),
});

const SectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  summary: z.string(),
  subsections: z.array(SubsectionSchema),
});

const ChapterSchema = z.object({
  title: z.string(),
  summary: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  sections: z.array(SectionSchema),
});

const DocumentSummarySchema = z.object({
  title: z.string(),
  shortSummary: z.string(),
  year: z.number().optional(),
  date: z.string().optional(),
  companies: z.array(z.string()),
  documentType: z.string().optional(),
});

const DocumentMetadataSchema = z.object({
  title: z.string(),
  publicationDate: z.string().optional(),
  year: z.string().optional(),
  summary: z.string().optional(),
  category: z.string(),
  subcategory: z.string(),
  industry: z.string().optional(),
  companies: z.array(z.string()).optional(),
  country: z.string().optional(),
  publisher: z.string().optional(),
  documentSubtype: z.string().optional(),
});

const ParsedDocumentSchema = z.object({
  totalPages: z.number(),
  pages: z.array(ParsedPageSchema),
  mediaBlocks: z.array(ParsedMediaBlockSchema),
  summary: DocumentSummarySchema.optional(),
  metadata: DocumentMetadataSchema.optional(),
  outline: z.array(SectionSchema).optional(),
  chapters: z.array(ChapterSchema).optional(),
  pageSummaries: z.array(z.object({
    pageNumber: z.number(),
    summary: z.string(),
  })).optional(),
});

export const ParsedDocument = ParsedDocumentSchema;
export type ParsedDocumentResponse = z.infer<typeof ParsedDocumentSchema>;

export const JobResultResponse = z.object({
  jobId: z.string(),
  status: JobStatus,
  result: ParsedDocumentSchema.optional(),
  error: z.string().optional(),
});

export type JobResult = z.infer<typeof JobResultResponse>;
