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

export const ParseUrlBody = z.object({
  url: z.string().url(),
  paddle: z.boolean().optional().default(false),
  textract: z.boolean().optional().default(false),
});

export const DownloadBody = z.object({
  url: z.string().url(),
  userAgent: z.string().optional(),
});

export const ParseHtmlBody = z
  .object({
    url: z.string().url().optional(),
    html: z.string().optional(),
    userAgent: z.string().optional(),
    maxCharsPerPage: z.number().int().positive().optional(),
    /**
     * When true, runs the LLM-based chapter + outline generation pipeline.
     * Adds a few seconds and costs tokens but produces navigable structure
     * for long documents (SEC filings, research papers). Defaults to true —
     * pass false to skip and get a faster markdown-only response.
     */
    generateOutline: z.boolean().optional().default(true),
  })
  .refine((v) => Boolean(v.url) !== Boolean(v.html), {
    message: "Provide exactly one of `url` or `html`",
  });

const HtmlSubsectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  summary: z.string(),
});
const HtmlSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  summary: z.string(),
  subsections: z.array(HtmlSubsectionSchema),
});
const HtmlChapterSchema = z.object({
  title: z.string(),
  summary: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  sections: z.array(HtmlSectionSchema),
});

export const ParseHtmlResponse = z.object({
  jobId: z.string().uuid(),
  status: z.literal("completed"),
  title: z.string(),
  totalPages: z.number(),
  htmlUrl: z.string().optional(),
  result: z.object({
    totalPages: z.number(),
    pages: z.array(z.object({ pageNumber: z.number(), content: z.string() })),
    chapters: z.array(HtmlChapterSchema).optional(),
    outline: z.array(HtmlSectionSchema).optional(),
  }),
});

export const ParseImageBody = z
  .object({
    url: z.string().url().optional(),
    imageBase64: z.string().optional(),
    mimeType: z.string().optional(),
    userAgent: z.string().optional(),
  })
  .refine((v) => Boolean(v.url) !== Boolean(v.imageBase64), {
    message: "Provide exactly one of `url` or `imageBase64`",
  });

// -- Unified /parse endpoint --

export const ParseAnyBody = z
  .object({
    url: z.string().url().optional(),
    fileBase64: z.string().optional(),
    filename: z.string().optional(),
    mimeType: z.string().optional(),
    userAgent: z.string().optional(),
    options: z
      .object({
        html: z
          .object({
            maxCharsPerPage: z.number().int().positive().optional(),
            /** Defaults to true — pass false to skip LLM outline generation. */
            generateOutline: z.boolean().optional().default(true),
          })
          .optional(),
        image: z.object({ model: z.string().optional() }).optional(),
        xlsx: z.object({ maxRowsPerSheet: z.number().int().positive().optional() }).optional(),
        pdf: z
          .object({
            paddle: z.boolean().optional(),
            textract: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .refine((v) => Boolean(v.url) !== Boolean(v.fileBase64), {
    message: "Provide exactly one of `url` or `fileBase64`",
  });

export const ParseFormatEnum = z.enum([
  "pdf",
  "html",
  "image",
  "docx",
  "xlsx",
  "pptx",
]);

export const ParseAnyResponse = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["completed", "processing"]),
  type: ParseFormatEnum,
  title: z.string().optional(),
  totalPages: z.number().optional(),
  sourceUrl: z.string().optional(),
  result: z
    .object({
      totalPages: z.number(),
      pages: z.array(z.object({ pageNumber: z.number(), content: z.string() })),
    })
    .optional(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
});

export const ParseImageResponse = z.object({
  jobId: z.string().uuid(),
  status: z.literal("completed"),
  title: z.string(),
  totalPages: z.number(),
  imageUrl: z.string().optional(),
  result: z.object({
    totalPages: z.number(),
    pages: z.array(z.object({ pageNumber: z.number(), content: z.string() })),
  }),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
});

export const DownloadResponse = z.object({
  success: z.boolean(),
  type: z.enum(["pdf", "html"]).optional(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  sizeBytes: z.number().optional(),
  error: z.string().optional(),
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
  pdfUrl: z.string().optional(),
  error: z.string().optional(),
});

export type JobResult = z.infer<typeof JobResultResponse>;
