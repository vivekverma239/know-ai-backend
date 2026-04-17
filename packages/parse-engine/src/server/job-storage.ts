import { Storage } from "@google-cloud/storage";
import { env } from "../env.js";
import type { ParsedDocumentResponse } from "./schemas.js";

let _client: Storage | null = null;

function resolveCredentials(): Record<string, unknown> | null {
  if (env.gcsCredentialsBase64) {
    return JSON.parse(Buffer.from(env.gcsCredentialsBase64, "base64").toString("utf-8"));
  }
  if (env.gcsCredentialsRaw) {
    const parsed = JSON.parse(env.gcsCredentialsRaw);
    if (parsed.private_key && typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  }
  return null;
}

function getClient(): Storage {
  if (_client) return _client;
  const creds = resolveCredentials();
  _client = creds
    ? new Storage({ credentials: creds as any, projectId: creds.project_id as string })
    : new Storage();
  return _client;
}

function getBucket() {
  const bucketName = env.gcsBucket;
  if (!bucketName) throw new Error("GOOGLE_STORAGE_BUCKET env var required");
  return getClient().bucket(bucketName);
}

function jobPrefix(jobId: string) {
  return `parse-jobs/${jobId}`;
}

/** Upload the source PDF for a job. */
export async function uploadJobPdf(jobId: string, buffer: Buffer): Promise<void> {
  const bucket = getBucket();
  const file = bucket.file(`${jobPrefix(jobId)}/document.pdf`);
  await file.save(buffer, { contentType: "application/pdf" });
}

/** Download the source PDF for a job (used by workflow). */
export async function downloadJobPdf(jobId: string): Promise<Buffer> {
  const bucket = getBucket();
  const [buffer] = await bucket.file(`${jobPrefix(jobId)}/document.pdf`).download();
  return buffer;
}

/** Write the parse result JSON. */
export async function writeJobResult(jobId: string, result: unknown): Promise<void> {
  const bucket = getBucket();
  const file = bucket.file(`${jobPrefix(jobId)}/result.json`);
  await file.save(JSON.stringify(result), { contentType: "application/json" });
}

/** Write an error record. */
export async function writeJobError(jobId: string, error: string): Promise<void> {
  const bucket = getBucket();
  const file = bucket.file(`${jobPrefix(jobId)}/error.json`);
  await file.save(JSON.stringify({ error, timestamp: new Date().toISOString() }), {
    contentType: "application/json",
  });
}

/** Generate a signed URL for the stored PDF (1 hour expiry). */
export async function getJobPdfSignedUrl(jobId: string): Promise<string | null> {
  const bucket = getBucket();
  const file = bucket.file(`${jobPrefix(jobId)}/document.pdf`);
  try {
    const [exists] = await file.exists();
    if (!exists) return null;
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 3600 * 1000,
    });
    return url;
  } catch {
    return null;
  }
}

/** Read job status and result/error from GCS. */
export async function readJobStatus(jobId: string): Promise<{
  status: "processing" | "completed" | "failed" | "not_found";
  result?: ParsedDocumentResponse;
  error?: string;
}> {
  const bucket = getBucket();
  const prefix = jobPrefix(jobId);

  // Check result first (most common query)
  try {
    const [resultBuf] = await bucket.file(`${prefix}/result.json`).download();
    return { status: "completed", result: JSON.parse(resultBuf.toString("utf-8")) };
  } catch { /* not found */ }

  // Check error
  try {
    const [errorBuf] = await bucket.file(`${prefix}/error.json`).download();
    const parsed = JSON.parse(errorBuf.toString("utf-8"));
    return { status: "failed", error: parsed.error };
  } catch { /* not found */ }

  // Check if PDF exists (job was submitted)
  try {
    const [exists] = await bucket.file(`${prefix}/document.pdf`).exists();
    if (exists) return { status: "processing" };
  } catch { /* not found */ }

  return { status: "not_found" };
}
