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
  textract: z.coerce.boolean().optional().default(true),
});

// -- Job Result --

export const JobStatus = z.enum(["processing", "completed", "failed", "not_found"]);

export const JobResultResponse = z.object({
  jobId: z.string(),
  status: JobStatus,
  result: z.unknown().optional(),
  error: z.string().optional(),
});
