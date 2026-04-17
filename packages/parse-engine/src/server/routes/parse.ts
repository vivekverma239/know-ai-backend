import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Client } from "@upstash/workflow";
import {
  ParseResponse,
  ParseQuerySchema,
  ParseUrlBody,
  DownloadBody,
  DownloadResponse,
  JobResultResponse,
  ErrorResponse,
} from "../schemas.js";
import { uploadJobPdf, readJobStatus, getJobPdfSignedUrl } from "../job-storage.js";
import { downloadPdfFromUrl } from "../download.js";

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
  const { url } = c.req.valid("json");

  try {
    const buffer = await downloadPdfFromUrl(url);
    const jobId = randomUUID();
    await uploadJobPdf(jobId, buffer);
    const pdfUrl = await getJobPdfSignedUrl(jobId);

    return c.json({
      success: true,
      pdfUrl: pdfUrl ?? undefined,
      sizeBytes: buffer.length,
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
