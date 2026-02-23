import "dotenv/config";
import fs from "node:fs";
import * as path from "node:path";

// ── Configuration ──────────────────────────────────────────────────────
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000/api/v1";
const BACKEND_TOKEN = process.env.BACKEND_TOKEN!;
const TEST_USER_ID = process.env.TEST_USER_ID || "test-user-e2e";
const TEST_ORG_ID = process.env.TEST_ORG_ID || "test-org-e2e";
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || "e2e@test.com";
const TEST_USER_NAME = process.env.TEST_USER_NAME || "E2E Test User";
const TEST_PDF_PATH = path.join(__dirname, "files", "test-file-meta.pdf");

// Timeouts
const PARSING_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes - parsing can be slow
const POLL_INTERVAL_MS = 10_000; // 10 seconds

// ── Helpers ────────────────────────────────────────────────────────────
const authHeaders = {
  Authorization: `Bearer ${BACKEND_TOKEN}`,
  "x-user-id": TEST_USER_ID,
  "x-org-id": TEST_ORG_ID,
  "x-user-email": TEST_USER_EMAIL,
  "x-user-name": TEST_USER_NAME,
};

type TestResult = { name: string; passed: boolean; detail: string; durationMs: number };
const results: TestResult[] = [];

function record(name: string, passed: boolean, detail: string, startMs: number) {
  const durationMs = Date.now() - startMs;
  results.push({ name, passed, detail, durationMs });
  const icon = passed ? "✅" : "❌";
  console.log(`${icon} ${name} (${(durationMs / 1000).toFixed(1)}s) — ${detail}`);
}

async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders, ...init?.headers },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: res.status, body };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Step 1: Upload PDF ─────────────────────────────────────────────────
async function uploadPdf(): Promise<string> {
  if (!fs.existsSync(TEST_PDF_PATH)) {
    throw new Error(`Test PDF not found at ${TEST_PDF_PATH}`);
  }

  const blob = new Blob([fs.readFileSync(TEST_PDF_PATH)], { type: "application/pdf" });
  const form = new FormData();
  form.append("file", blob, "e2e-test-document.pdf");

  const res = await fetch(`${API_BASE_URL}/files/upload`, {
    method: "POST",
    headers: authHeaders,
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} — ${text}`);
  }

  const data = (await res.json()) as { fileId: string; name: string; status: string };
  return data.fileId;
}

// ── Step 2: Poll until completed ───────────────────────────────────────
async function waitForCompletion(fileId: string): Promise<Record<string, unknown>> {
  const start = Date.now();

  while (Date.now() - start < PARSING_TIMEOUT_MS) {
    const { body } = await api<Record<string, unknown>>(`/files/${fileId}`);
    const status = body.status as string;

    console.log(`   polling: status=${status} (${((Date.now() - start) / 1000).toFixed(0)}s elapsed)`);

    if (status === "completed" || status === "processed") return body;
    if (status === "failed") throw new Error("File status is 'failed'");

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out after ${PARSING_TIMEOUT_MS / 1000}s waiting for completion`);
}

// ── Step 3: Verify parsed artifacts ────────────────────────────────────
async function verifyPages(fileId: string): Promise<number> {
  const { status, body } = await api<{ total: number; items: unknown[] }>(
    `/files/pages?fileId=${fileId}`,
  );
  if (status !== 200) throw new Error(`GET pages returned ${status}`);
  return body.total ?? body.items?.length ?? 0;
}

async function verifySections(fileId: string): Promise<number> {
  const { status, body } = await api<{ total: number; items: unknown[] }>(
    `/files/sections?fileId=${fileId}`,
  );
  if (status !== 200) throw new Error(`GET sections returned ${status}`);
  return body.total ?? body.items?.length ?? 0;
}

async function verifyChapters(fileId: string): Promise<number> {
  const { status, body } = await api<unknown[]>(
    `/files/chapters?fileId=${fileId}`,
  );
  if (status !== 200) throw new Error(`GET chapters returned ${status}`);
  return Array.isArray(body) ? body.length : 0;
}

async function verifyFileDetail(fileId: string): Promise<Record<string, unknown>> {
  const { status, body } = await api<Record<string, unknown>>(`/files/${fileId}`);
  if (status !== 200) throw new Error(`GET file detail returned ${status}`);
  return body;
}

// ── Step 4: Cleanup ────────────────────────────────────────────────────
async function deleteFile(fileId: string): Promise<boolean> {
  const { status } = await api(`/files/${fileId}`, { method: "DELETE" });
  return status === 200 || status === 204;
}

// ── Main test runner ───────────────────────────────────────────────────
async function run() {
  console.log("=".repeat(60));
  console.log("  E2E Ingestion Test — Upload → Parse → Verify");
  console.log("=".repeat(60));
  console.log(`  API:     ${API_BASE_URL}`);
  console.log(`  User:    ${TEST_USER_ID}`);
  console.log(`  Org:     ${TEST_ORG_ID}`);
  console.log(`  PDF:     ${TEST_PDF_PATH}`);
  console.log("=".repeat(60));
  console.log();

  // Pre-flight checks
  if (!BACKEND_TOKEN) throw new Error("BACKEND_TOKEN env var is required");
  if (!fs.existsSync(TEST_PDF_PATH)) throw new Error("Test PDF not found");

  let fileId: string | null = null;

  try {
    // ── 1. Upload ────────────────────────────────────────────────────
    {
      const t = Date.now();
      console.log("[1/6] Uploading PDF...");
      fileId = await uploadPdf();
      record("Upload PDF", Boolean(fileId), `fileId=${fileId}`, t);
    }

    // ── 2. Wait for processing ───────────────────────────────────────
    {
      const t = Date.now();
      console.log("\n[2/6] Waiting for parsing to complete...");
      const finalDoc = await waitForCompletion(fileId);
      const status = finalDoc.status as string;
      record(
        "Parsing completes",
        status === "completed" || status === "processed",
        `status=${status}`,
        t,
      );
    }

    // ── 3. Verify pages ──────────────────────────────────────────────
    {
      const t = Date.now();
      console.log("\n[3/6] Verifying parsed pages...");
      const pageCount = await verifyPages(fileId);
      record("Pages extracted", pageCount > 0, `${pageCount} pages`, t);
    }

    // ── 4. Verify chapters (outline callback can be slower) ──────────
    {
      const t = Date.now();
      console.log("\n[4/6] Verifying chapters (waiting up to 120s for outline callback)...");
      let chapterCount = 0;
      for (let attempt = 0; attempt < 12; attempt++) {
        chapterCount = await verifyChapters(fileId);
        if (chapterCount > 0) break;
        console.log(`   waiting for chapters... (${(attempt + 1) * 10}s)`);
        await sleep(10_000);
      }
      record("Chapters extracted", chapterCount > 0, `${chapterCount} chapters`, t);
    }

    // ── 5. Verify sections ───────────────────────────────────────────
    {
      const t = Date.now();
      console.log("\n[5/6] Verifying sections...");
      const sectionCount = await verifySections(fileId);
      record("Sections extracted", sectionCount > 0, `${sectionCount} sections`, t);
    }

    // ── 6. Verify metadata ───────────────────────────────────────────
    {
      const t = Date.now();
      console.log("\n[6/6] Verifying document metadata...");
      const detail = await verifyFileDetail(fileId);
      const metadata = detail.metadata as Record<string, unknown> | null;
      const hasTitle = Boolean(metadata?.title);
      const hasSummary = Boolean(metadata?.summary);
      record(
        "Metadata populated",
        hasTitle && hasSummary,
        `title=${hasTitle}, summary=${hasSummary}`,
        t,
      );
    }
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────
    if (fileId) {
      console.log("\nCleaning up test file...");
      const deleted = await deleteFile(fileId);
      console.log(deleted ? "  Cleanup: file deleted" : "  Cleanup: delete failed (non-critical)");
    }
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    console.log(`  ${icon} ${r.name.padEnd(25)} ${r.detail}`);
  }

  console.log("-".repeat(60));
  console.log(`  ${passed} passed, ${failed} failed — total ${(totalMs / 1000).toFixed(1)}s`);
  console.log("=".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
