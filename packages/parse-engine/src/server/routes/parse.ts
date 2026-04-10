import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Client } from "@upstash/workflow";
import {
  ParseResponse,
  ParseQuerySchema,
  JobResultResponse,
  ErrorResponse,
} from "../schemas.js";
import { uploadJobPdf, readJobStatus } from "../job-storage.js";

export const parseApp = new OpenAPIHono();

// --- POST /parse ---

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

  // Trigger Upstash workflow
  const workflowUrl = `${process.env.APP_URL}/workflow`;
  const client = new Client({ token: process.env.QSTASH_TOKEN! });
  await client.trigger({
    url: workflowUrl,
    body: { jobId, useTextract: textract, usePaddle: paddle },
  });

  return c.json({ jobId, status: "processing" as const }, 202);
});

// --- GET /parse/:jobId ---

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

  return c.json({ jobId, ...job }, 200);
});
