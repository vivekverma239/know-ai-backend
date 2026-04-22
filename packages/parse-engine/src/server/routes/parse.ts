import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Client } from "@upstash/workflow";
import {
  ParseResponse,
  ParseQuerySchema,
  ParseUrlBody,
  ParseHtmlBody,
  ParseHtmlResponse,
  ParseImageBody,
  ParseImageResponse,
  ParseAnyBody,
  ParseAnyResponse,
  DownloadBody,
  DownloadResponse,
  JobResultResponse,
  ErrorResponse,
} from "../schemas.js";
import {
  uploadJobPdf,
  uploadJobHtml,
  uploadJobImage,
  uploadJobFile,
  writeJobResult,
  readJobStatus,
  getJobPdfSignedUrl,
  getJobFileSignedUrl,
} from "../job-storage.js";
import { downloadFromUrl, downloadHtmlFromUrl, downloadPdfFromUrl } from "../download.js";
import { parseHtmlToMarkdown, parseHtmlToMarkdownWithOutline } from "../../html-parser.js";
import { parseImageToMarkdown, detectImageMime } from "../../image-parser.js";
import { parseDocxToMarkdown } from "../../docx-parser.js";
import { parseXlsxToMarkdown } from "../../xlsx-parser.js";
import { detectFormat, type ParseFormat } from "../../parse-dispatch.js";
import { enrichDocument } from "../../services/enrich.js";

export const parseApp = new OpenAPIHono();

// ── helpers ──

async function triggerWorkflow(jobId: string, textract: boolean, paddle: boolean) {
  const workflowUrl = `${process.env.APP_URL}/workflow`;
  const client = new Client({ token: process.env.QSTASH_TOKEN! });
  const usePaddle = paddle || !!process.env.MODAL_ENDPOINT_URL;
  await client.trigger({
    url: workflowUrl,
    body: { jobId, useTextract: textract, usePaddle },
    headers: { "Upstash-Timeout": "300" },
  });
}

// ── POST /parse (file upload) ──

const postParseRoute = createRoute({
  method: "post",
  path: "/parse",
  tags: ["Parse"],
  summary: "Upload a PDF and start parsing",
  description:
    "Accepts a PDF file upload, stores it, and triggers an async parse workflow. Returns a jobId for polling results.",
  request: {
    query: ParseQuerySchema,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      description: "Parse job accepted",
      content: { "application/json": { schema: ParseResponse } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

parseApp.openapi(postParseRoute, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "Missing or invalid 'file' field" }, 400);
  }
  if (file.type !== "application/pdf") {
    return c.json({ error: "File must be a PDF" }, 400);
  }

  const { paddle, textract } = c.req.valid("query");
  const jobId = randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());

  await uploadJobPdf(jobId, buffer);
  await triggerWorkflow(jobId, textract, paddle);

  return c.json({ jobId, status: "processing" as const }, 202);
});

// ── POST /parse/url ──

const postParseUrlRoute = createRoute({
  method: "post",
  path: "/parse/url",
  tags: ["Parse"],
  summary: "Parse a PDF from a URL",
  description:
    "Downloads a PDF from the given URL (with headless browser fallback for bot-protected pages), stores it, and triggers the parse workflow.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ParseUrlBody } },
    },
  },
  responses: {
    202: {
      description: "Parse job accepted",
      content: { "application/json": { schema: ParseResponse } },
    },
    400: {
      description: "Bad request / download failed",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

parseApp.openapi(postParseUrlRoute, async (c) => {
  const { url, paddle, textract } = c.req.valid("json");

  let buffer: Buffer;
  try {
    buffer = await downloadPdfFromUrl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `PDF download failed: ${msg}` }, 400);
  }

  const jobId = randomUUID();
  await uploadJobPdf(jobId, buffer);
  await triggerWorkflow(jobId, textract, paddle);

  return c.json({ jobId, status: "processing" as const }, 202);
});

// ── POST /parse/html ──

const postParseHtmlRoute = createRoute({
  method: "post",
  path: "/parse/html",
  tags: ["Parse"],
  summary: "Parse HTML into markdown pages",
  description:
    "Parses an HTML document into a ParsedDocument with markdown pages and merged-cell-aware tables. " +
    "Accepts either a URL (which is downloaded via the stealth browser so bot protection is bypassed) " +
    "or a raw HTML string. The cleaned HTML is stored alongside the result for client preview.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ParseHtmlBody } },
    },
  },
  responses: {
    200: {
      description: "HTML parsed successfully",
      content: { "application/json": { schema: ParseHtmlResponse } },
    },
    400: {
      description: "Download or parse failed",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

parseApp.openapi(postParseHtmlRoute, async (c) => {
  const { url, html, userAgent, maxCharsPerPage, generateOutline, generateEnrichment } =
    c.req.valid("json");

  let rawHtml: string;
  let downloadedTitle: string | undefined;
  try {
    if (url) {
      const downloaded = await downloadHtmlFromUrl(url, { userAgent });
      rawHtml = downloaded.html;
      downloadedTitle = downloaded.title;
    } else {
      rawHtml = html!;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `HTML fetch failed: ${msg}` }, 400);
  }

  let parsed: Awaited<ReturnType<typeof parseHtmlToMarkdownWithOutline>>;
  try {
    parsed = generateOutline
      ? await parseHtmlToMarkdownWithOutline(rawHtml, {
          maxCharsPerPage,
          outlineOptions: { enrich: generateEnrichment },
        })
      : parseHtmlToMarkdown(rawHtml, { maxCharsPerPage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `HTML parse failed: ${msg}` }, 400);
  }

  // When outline is off but enrichment is on, run enrichment standalone.
  if (!generateOutline && generateEnrichment && parsed.pages.length > 0) {
    const enrichResult = await enrichDocument(parsed.pages, {
      title: parsed.title || downloadedTitle || "",
    });
    parsed = { ...parsed, summary: enrichResult.summary, metadata: enrichResult.metadata };
  }

  const jobId = randomUUID();
  await Promise.all([
    uploadJobHtml(jobId, rawHtml),
    writeJobResult(jobId, {
      totalPages: parsed.totalPages,
      pages: parsed.pages,
      title: parsed.title || downloadedTitle || "",
      mediaBlocks: [],
      chapters: parsed.chapters,
      outline: parsed.outline,
      summary: parsed.summary,
      metadata: parsed.metadata,
    }),
  ]);
  const htmlUrl = await getJobFileSignedUrl(jobId, "document.html");

  return c.json(
    {
      jobId,
      status: "completed" as const,
      title: parsed.title || downloadedTitle || "",
      totalPages: parsed.totalPages,
      htmlUrl: htmlUrl ?? undefined,
      result: {
        totalPages: parsed.totalPages,
        pages: parsed.pages,
        ...(parsed.chapters ? { chapters: parsed.chapters } : {}),
        ...(parsed.outline ? { outline: parsed.outline } : {}),
        ...(parsed.summary ? { summary: parsed.summary } : {}),
        ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
      },
    },
    200,
  );
});

// ── POST /parse/image ──

const postParseImageRoute = createRoute({
  method: "post",
  path: "/parse/image",
  tags: ["Parse"],
  summary: "Parse an image into markdown",
  description:
    "Extracts content from an image (PNG/JPEG/WebP/GIF) using Claude Sonnet " +
    "vision. Tables and charts are converted to markdown tables. Accepts " +
    "either a URL (downloaded via the stealth browser) or a base64-encoded " +
    "image payload. Output mirrors the PDF/HTML ParsedDocument shape with a " +
    "single page.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ParseImageBody } },
    },
  },
  responses: {
    200: {
      description: "Image parsed successfully",
      content: { "application/json": { schema: ParseImageResponse } },
    },
    400: {
      description: "Download or parse failed",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

parseApp.openapi(postParseImageRoute, async (c) => {
  const { url, imageBase64, mimeType: providedMime, userAgent, generateEnrichment } =
    c.req.valid("json");

  // Load image bytes + infer MIME
  let imageBuffer: Buffer;
  let mimeType: string;
  try {
    if (url) {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent ?? "Mozilla/5.0 (compatible; KnowsisAI/1.0)" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`Image download failed: ${res.status} ${res.statusText}`);
      imageBuffer = Buffer.from(await res.arrayBuffer());
      mimeType =
        providedMime ??
        res.headers.get("content-type")?.split(";")[0] ??
        detectImageMime(imageBuffer) ??
        "";
    } else {
      imageBuffer = Buffer.from(imageBase64!, "base64");
      mimeType = providedMime ?? detectImageMime(imageBuffer) ?? "";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Image fetch failed: ${msg}` }, 400);
  }

  if (!mimeType) {
    return c.json({ error: "Could not determine image MIME type" }, 400);
  }

  // Parse via Claude vision
  let parsed: Awaited<ReturnType<typeof parseImageToMarkdown>>;
  try {
    parsed = await parseImageToMarkdown(imageBuffer, mimeType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Image parse failed: ${msg}` }, 400);
  }

  // Optional enrichment — 2 extra LLM calls, defaults on.
  const enrichment = generateEnrichment && parsed.pages.length > 0
    ? await enrichDocument(parsed.pages, { title: parsed.title })
    : {};

  // Store source image + parsed result
  const jobId = randomUUID();
  const [storedFilename] = await Promise.all([
    uploadJobImage(jobId, imageBuffer, mimeType),
    writeJobResult(jobId, {
      totalPages: parsed.totalPages,
      pages: parsed.pages,
      title: parsed.title,
      mediaBlocks: [],
      summary: enrichment.summary,
      metadata: enrichment.metadata,
    }),
  ]);
  const imageUrl = await getJobFileSignedUrl(jobId, storedFilename);

  return c.json(
    {
      jobId,
      status: "completed" as const,
      title: parsed.title,
      totalPages: parsed.totalPages,
      imageUrl: imageUrl ?? undefined,
      result: {
        totalPages: parsed.totalPages,
        pages: parsed.pages,
        ...(enrichment.summary ? { summary: enrichment.summary } : {}),
        ...(enrichment.metadata ? { metadata: enrichment.metadata } : {}),
      },
      usage: parsed.usage,
    },
    200,
  );
});

// ── POST /parse-any (unified dispatcher) ──

const FORMAT_TO_EXT: Record<Exclude<ParseFormat, "unknown">, string> = {
  pdf: "pdf",
  html: "html",
  image: "png", // refined per-request from actual MIME
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

const postParseAnyRoute = createRoute({
  method: "post",
  path: "/parse-any",
  tags: ["Parse"],
  summary: "Parse any supported file format",
  description:
    "Unified entry point: accepts a URL or base64 file, auto-detects the " +
    "format (PDF, HTML, image, DOCX, XLSX, PPTX) from MIME / magic bytes / " +
    "filename, and returns the same ParsedDocument shape regardless of " +
    "source. PDF and PPTX jobs are async (returns status: 'processing' with " +
    "jobId to poll); HTML, image, DOCX, and XLSX are synchronous.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ParseAnyBody } },
    },
  },
  responses: {
    200: {
      description: "Parse completed or accepted",
      content: { "application/json": { schema: ParseAnyResponse } },
    },
    400: {
      description: "Download, detection, or parse failed",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

parseApp.openapi(postParseAnyRoute, async (c) => {
  const { url, fileBase64, filename, mimeType, userAgent, options } = c.req.valid("json");

  // Step 1: load bytes + compute a best-effort MIME hint
  let buffer: Buffer;
  let effectiveMime = mimeType ?? "";
  let effectiveFilename = filename ?? "";

  try {
    if (url) {
      // Try HEAD first for a MIME probe; then do a GET with browser fallback
      try {
        const head = await fetch(url, {
          method: "HEAD",
          headers: { "User-Agent": userAgent ?? "Mozilla/5.0 (compatible; KnowsisAI/1.0)" },
          redirect: "follow",
        });
        if (head.ok) effectiveMime = effectiveMime || head.headers.get("content-type") || "";
      } catch { /* HEAD unsupported — continue */ }

      effectiveFilename = effectiveFilename || new URL(url).pathname.split("/").pop() || "";

      // Decide fetch strategy based on probable type
      const probable = detectFormat({ mimeType: effectiveMime, filename: effectiveFilename });
      if (probable === "html") {
        const dl = await downloadHtmlFromUrl(url, { userAgent });
        buffer = Buffer.from(dl.html, "utf-8");
        effectiveMime = "text/html; charset=utf-8";
      } else {
        // For everything else (PDF/image/office), do a browser-aware GET
        const res = await fetch(url, {
          headers: { "User-Agent": userAgent ?? "Mozilla/5.0 (compatible; KnowsisAI/1.0)" },
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
        buffer = Buffer.from(await res.arrayBuffer());
        effectiveMime = effectiveMime || res.headers.get("content-type") || "";
      }
    } else {
      buffer = Buffer.from(fileBase64!, "base64");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Fetch failed: ${msg}` }, 400);
  }

  // Step 2: resolve format
  const format = detectFormat({ buffer, mimeType: effectiveMime, filename: effectiveFilename });
  if (format === "unknown") {
    return c.json(
      {
        error:
          "Could not determine file format. Provide mimeType, filename, or ensure the file has recognisable magic bytes.",
      },
      400,
    );
  }

  const jobId = randomUUID();

  // Step 3: dispatch
  try {
    if (format === "pdf") {
      await uploadJobPdf(jobId, buffer);
      const paddle = options?.pdf?.paddle ?? false;
      const textract = options?.pdf?.textract ?? false;
      await triggerWorkflow(jobId, textract, paddle);
      const sourceUrl = await getJobPdfSignedUrl(jobId);
      return c.json(
        { jobId, status: "processing" as const, type: "pdf" as const, sourceUrl: sourceUrl ?? undefined },
        200,
      );
    }

    if (format === "html") {
      const html = buffer.toString("utf-8");
      // Destructuring defaults cover the case where the caller omits
      // `options` entirely — zod's nested defaults only fire when
      // `options.html` is actually parsed.
      const {
        generateOutline: shouldOutline = true,
        generateEnrichment: shouldEnrich = true,
        ...htmlParseOpts
      } = options?.html ?? {};
      let parsed = shouldOutline
        ? await parseHtmlToMarkdownWithOutline(html, {
            ...htmlParseOpts,
            outlineOptions: { enrich: shouldEnrich },
          })
        : parseHtmlToMarkdown(html, htmlParseOpts);

      // Enrichment-without-outline path (runs its own pageSummaries pass).
      if (!shouldOutline && shouldEnrich && parsed.pages.length > 0) {
        const enrichResult = await enrichDocument(parsed.pages, { title: parsed.title });
        parsed = { ...parsed, summary: enrichResult.summary, metadata: enrichResult.metadata };
      }

      await Promise.all([
        uploadJobHtml(jobId, html),
        writeJobResult(jobId, {
          totalPages: parsed.totalPages,
          pages: parsed.pages,
          title: parsed.title,
          mediaBlocks: [],
          chapters: parsed.chapters,
          outline: parsed.outline,
          summary: parsed.summary,
          metadata: parsed.metadata,
        }),
      ]);
      const sourceUrl = await getJobFileSignedUrl(jobId, "document.html");
      return c.json(
        {
          jobId,
          status: "completed" as const,
          type: "html" as const,
          title: parsed.title,
          totalPages: parsed.totalPages,
          sourceUrl: sourceUrl ?? undefined,
          result: {
            totalPages: parsed.totalPages,
            pages: parsed.pages,
            ...(parsed.chapters ? { chapters: parsed.chapters } : {}),
            ...(parsed.outline ? { outline: parsed.outline } : {}),
            ...(parsed.summary ? { summary: parsed.summary } : {}),
            ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
          },
        },
        200,
      );
    }

    if (format === "image") {
      const sniffedMime = detectImageMime(buffer) ?? effectiveMime.split(";")[0].trim();
      if (!sniffedMime) throw new Error("Could not determine image MIME type");
      const parsed = await parseImageToMarkdown(buffer, sniffedMime, {
        model: options?.image?.model,
      });

      const shouldEnrich = options?.image?.generateEnrichment ?? true;
      const enrichment = shouldEnrich && parsed.pages.length > 0
        ? await enrichDocument(parsed.pages, { title: parsed.title })
        : {};

      const [storedFilename] = await Promise.all([
        uploadJobImage(jobId, buffer, sniffedMime),
        writeJobResult(jobId, {
          totalPages: parsed.totalPages,
          pages: parsed.pages,
          title: parsed.title,
          mediaBlocks: [],
          summary: enrichment.summary,
          metadata: enrichment.metadata,
        }),
      ]);
      const sourceUrl = await getJobFileSignedUrl(jobId, storedFilename);
      return c.json(
        {
          jobId,
          status: "completed" as const,
          type: "image" as const,
          title: parsed.title,
          totalPages: parsed.totalPages,
          sourceUrl: sourceUrl ?? undefined,
          result: {
            totalPages: parsed.totalPages,
            pages: parsed.pages,
            ...(enrichment.summary ? { summary: enrichment.summary } : {}),
            ...(enrichment.metadata ? { metadata: enrichment.metadata } : {}),
          },
          usage: parsed.usage,
        },
        200,
      );
    }

    if (format === "docx") {
      const {
        generateOutline: shouldOutline = true,
        generateEnrichment: shouldEnrich = true,
        ...htmlParseOpts
      } = options?.html ?? {};
      const parsed = await parseDocxToMarkdown(buffer, {
        ...htmlParseOpts,
        generateOutline: shouldOutline,
        generateEnrichment: shouldEnrich,
      });
      await Promise.all([
        uploadJobFile(
          jobId,
          buffer,
          FORMAT_TO_EXT.docx,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        writeJobResult(jobId, {
          totalPages: parsed.totalPages,
          pages: parsed.pages,
          title: parsed.title,
          mediaBlocks: [],
          chapters: parsed.chapters,
          outline: parsed.outline,
          summary: parsed.summary,
          metadata: parsed.metadata,
        }),
      ]);
      const sourceUrl = await getJobFileSignedUrl(jobId, "document.docx");
      return c.json(
        {
          jobId,
          status: "completed" as const,
          type: "docx" as const,
          title: parsed.title,
          totalPages: parsed.totalPages,
          sourceUrl: sourceUrl ?? undefined,
          result: {
            totalPages: parsed.totalPages,
            pages: parsed.pages,
            ...(parsed.chapters ? { chapters: parsed.chapters } : {}),
            ...(parsed.outline ? { outline: parsed.outline } : {}),
            ...(parsed.summary ? { summary: parsed.summary } : {}),
            ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
          },
        },
        200,
      );
    }

    if (format === "xlsx") {
      const { generateEnrichment: shouldEnrich = true, ...xlsxParseOpts } = options?.xlsx ?? {};
      const parsed = parseXlsxToMarkdown(buffer, xlsxParseOpts);
      const flatPages = parsed.pages.map(({ pageNumber, content }) => ({ pageNumber, content }));

      const enrichment = shouldEnrich && flatPages.length > 0
        ? await enrichDocument(flatPages, { title: parsed.title })
        : {};

      await Promise.all([
        uploadJobFile(
          jobId,
          buffer,
          FORMAT_TO_EXT.xlsx,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        writeJobResult(jobId, {
          totalPages: parsed.totalPages,
          pages: flatPages,
          title: parsed.title,
          mediaBlocks: [],
          summary: enrichment.summary,
          metadata: enrichment.metadata,
        }),
      ]);
      const sourceUrl = await getJobFileSignedUrl(jobId, "document.xlsx");
      return c.json(
        {
          jobId,
          status: "completed" as const,
          type: "xlsx" as const,
          title: parsed.title,
          totalPages: parsed.totalPages,
          sourceUrl: sourceUrl ?? undefined,
          result: {
            totalPages: parsed.totalPages,
            pages: flatPages,
            ...(enrichment.summary ? { summary: enrichment.summary } : {}),
            ...(enrichment.metadata ? { metadata: enrichment.metadata } : {}),
          },
        },
        200,
      );
    }

    // PPTX is intentionally not implemented yet — it needs pptx-to-pdf
    // (LibreOffice) and routes through the PDF workflow. Return a clear
    // 400 so callers know it's on the roadmap.
    return c.json({ error: `Format '${format}' is not yet implemented` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Parse failed (${format}): ${msg}` }, 400);
  }
});

// ── POST /download ──

const postDownloadRoute = createRoute({
  method: "post",
  path: "/download",
  tags: ["Download"],
  summary: "Download a PDF from a URL",
  description:
    "Downloads a PDF from the given URL using direct fetch with headless browser fallback for bot-protected pages. Returns a signed URL to the stored PDF.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: DownloadBody } },
    },
  },
  responses: {
    200: {
      description: "PDF downloaded and stored",
      content: { "application/json": { schema: DownloadResponse } },
    },
    400: {
      description: "Download failed",
      content: { "application/json": { schema: DownloadResponse } },
    },
  },
});

parseApp.openapi(postDownloadRoute, async (c) => {
  const { url, userAgent } = c.req.valid("json");

  try {
    const jobId = randomUUID();
    const result = await downloadFromUrl(url, { userAgent });

    if (result.type === "pdf") {
      await uploadJobPdf(jobId, result.buffer);
      const signedUrl = await getJobPdfSignedUrl(jobId);
      return c.json({
        success: true,
        type: "pdf" as const,
        url: signedUrl ?? undefined,
        sizeBytes: result.buffer.length,
      }, 200);
    }

    // HTML
    await uploadJobHtml(jobId, result.html);
    const signedUrl = await getJobFileSignedUrl(jobId, "document.html");
    return c.json({
      success: true,
      type: "html" as const,
      url: signedUrl ?? undefined,
      title: result.title,
      sizeBytes: Buffer.byteLength(result.html, "utf-8"),
    }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 400);
  }
});

// ── GET /parse/:jobId ──

const getJobRoute = createRoute({
  method: "get",
  path: "/parse/{jobId}",
  tags: ["Parse"],
  summary: "Get parse job status and result",
  request: {
    params: z.object({ jobId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Job status",
      content: { "application/json": { schema: JobResultResponse } },
    },
    404: {
      description: "Job not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

parseApp.openapi(getJobRoute, async (c) => {
  const { jobId } = c.req.valid("param");
  const job = await readJobStatus(jobId);

  if (job.status === "not_found") {
    return c.json({ error: "Job not found" }, 404);
  }

  const pdfUrl = await getJobPdfSignedUrl(jobId);

  return c.json({ jobId, ...job, pdfUrl: pdfUrl ?? undefined }, 200);
});
