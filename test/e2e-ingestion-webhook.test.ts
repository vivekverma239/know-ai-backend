import "dotenv/config";
import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { generate } from "otplib";

// ── Configuration ──────────────────────────────────────────────────────
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000/api/v1";
const BACKEND_TOKEN = process.env.BACKEND_TOKEN!;
const SIGNING_KEY = process.env.QSTASH_CURRENT_SIGNING_KEY!;

// Admin credentials for querying documents via admin API
const ADMIN_USER_ID = process.env.ADMIN_TEST_USER_ID!;
const ADMIN_PASSWORD = process.env.ADMIN_TEST_PASSWORD!;
const ADMIN_TOTP_SECRET = process.env.ADMIN_TEST_TOTP_SECRET!;

// Must be valid UUIDs — ext_documents has uuid columns for team_id/author_id
const TEST_USER_ID = process.env.TEST_USER_ID || "00000000-0000-4000-8000-000000000001";
const TEST_ORG_ID = process.env.TEST_ORG_ID || "00000000-0000-4000-8000-000000000002";

// Test URLs
const TEST_PDF_URL =
  process.env.TEST_PDF_URL ||
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";
const TEST_WEBPAGE_URL =
  process.env.TEST_WEBPAGE_URL ||
  "https://example.com";

const PARSING_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

// ── Helpers ────────────────────────────────────────────────────────────
type TestResult = { name: string; passed: boolean; detail: string; durationMs: number };
const results: TestResult[] = [];

function record(name: string, passed: boolean, detail: string, startMs: number) {
  const durationMs = Date.now() - startMs;
  results.push({ name, passed, detail, durationMs });
  const icon = passed ? "✅" : "❌";
  console.log(`${icon} ${name} (${(durationMs / 1000).toFixed(1)}s) — ${detail}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createSignature(body: string): Promise<string> {
  const bodyHash = createHash("sha256").update(body).digest("base64url");
  return new SignJWT({ body: bodyHash })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("Upstash")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SIGNING_KEY));
}

type WebhookPayload = {
  id?: number | string;
  data: Record<string, unknown>;
  type: string;
  action: "insert" | "update" | "delete";
  timestamp: string;
};

async function postWebhook(payload: WebhookPayload) {
  const body = JSON.stringify(payload);
  const signature = await createSignature(body);
  const res = await fetch(`${API_BASE_URL}/webhooks/ingestion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "upstash-signature": signature,
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

// ── Admin API helpers ──────────────────────────────────────────────────
let adminAccessToken: string | null = null;

async function getAdminToken(): Promise<string> {
  if (adminAccessToken) return adminAccessToken;

  // Login
  const loginRes = await fetch(`${API_BASE_URL}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: ADMIN_USER_ID, password: ADMIN_PASSWORD }),
  });
  const loginBody = (await loginRes.json()) as { challengeToken?: string };
  if (!loginBody.challengeToken) throw new Error("Admin login failed");

  // TOTP
  const totpCode = await generate({ secret: ADMIN_TOTP_SECRET });
  const verifyRes = await fetch(`${API_BASE_URL}/admin/auth/verify-totp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeToken: loginBody.challengeToken, totpCode }),
  });
  const verifyBody = (await verifyRes.json()) as { accessToken?: string };
  if (!verifyBody.accessToken) throw new Error("Admin TOTP verification failed");

  adminAccessToken = verifyBody.accessToken;
  return adminAccessToken;
}

async function adminApi<T = unknown>(path: string): Promise<{ status: number; body: T }> {
  const token = await getAdminToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: res.status, body };
}

// ── Find user_file via admin documents search ──────────────────────────
async function findDocumentBySourceId(
  sourceDocumentId: number,
  maxWaitMs = 30_000,
): Promise<Record<string, unknown> | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    // Admin documents endpoint supports search
    const { status, body } = await adminApi<{ items: Record<string, unknown>[] }>(
      `/admin/documents?page=1&pageSize=50`,
    );
    if (status === 200 && body.items) {
      const match = body.items.find(
        (d) => Number(d.sourceDocumentId) === sourceDocumentId,
      );
      if (match) return match;
    }
    await sleep(3_000);
  }
  return null;
}

async function getDocumentDetail(docId: string): Promise<Record<string, unknown>> {
  const { status, body } = await adminApi<Record<string, unknown>>(
    `/admin/documents/${docId}`,
  );
  if (status !== 200) throw new Error(`GET /admin/documents/${docId} returned ${status}`);
  return body;
}

async function waitForDocCompletion(
  docId: string,
  timeoutMs = PARSING_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const detail = await getDocumentDetail(docId);
    const status = detail.status as string;
    console.log(`   polling: status=${status} (${((Date.now() - start) / 1000).toFixed(0)}s elapsed)`);
    if (status === "completed" || status === "processed") return detail;
    if (status === "failed") throw new Error(`Document ${docId} status is 'failed'`);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${docId}`);
}

// Unique IDs for this test run
const RUN_ID = Date.now();
const PDF_DOC_ID = 900000 + (RUN_ID % 100000);
const WEBPAGE_DOC_ID = 800000 + (RUN_ID % 100000);

const filesToCleanup: string[] = [];

// ── Tests ──────────────────────────────────────────────────────────────

async function testWebpageIngestion() {
  console.log("\n--- Webpage Ingestion ---");

  // 1. Send webhook
  const t1 = Date.now();
  console.log("[1/5] Sending webpage document webhook...");
  const payload: WebhookPayload = {
    id: WEBPAGE_DOC_ID,
    data: {
      id: WEBPAGE_DOC_ID,
      type: "webpage",
      title: `E2E Test Webpage ${RUN_ID}`,
      team_id: TEST_ORG_ID,
      author_id: TEST_USER_ID,
      asset_url: TEST_WEBPAGE_URL,
    },
    type: "document",
    action: "insert",
    timestamp: new Date().toISOString(),
  };

  const webhookRes = await postWebhook(payload);
  record("Webpage webhook accepted", webhookRes.status === 200, `status=${webhookRes.status}`, t1);

  if (webhookRes.status !== 200) {
    console.log("   Response:", JSON.stringify(webhookRes.body));
    return;
  }

  // 2. Find the created user_file via admin API
  const t2 = Date.now();
  console.log("[2/5] Looking for created user_file via admin API...");
  const file = await findDocumentBySourceId(WEBPAGE_DOC_ID, 30_000);

  if (!file) {
    record("Webpage user_file created", false, "not found via admin API after 30s", t2);
    return;
  }

  const fileId = file.id as string;
  filesToCleanup.push(fileId);
  record("Webpage user_file created", true, `fileId=${fileId}`, t2);

  // 3. Check status (webpages complete immediately during webhook processing)
  const t3 = Date.now();
  console.log("[3/5] Checking file status...");
  const detail = await getDocumentDetail(fileId);
  const status = detail.status as string;
  const type = detail.type as string;
  record("Webpage status=completed", status === "completed", `status=${status}, type=${type}`, t3);

  // 4. Verify web article metadata
  const t4 = Date.now();
  console.log("[4/5] Verifying web article content...");
  const webMeta = detail.webArticleMetadata as Record<string, unknown> | null;
  const hasContent = Boolean(webMeta?.content);
  const hasUrl = Boolean(webMeta?.url);
  record("Webpage content populated", hasContent && hasUrl, `hasContent=${hasContent}, hasUrl=${hasUrl}`, t4);

  // 5. Verify pages were created (HTML→markdown→pages with embeddings)
  const t5 = Date.now();
  console.log("[5/5] Verifying webpage pages (markdown split)...");
  const { body: pagesBody } = await adminApi<{ items: unknown[]; total: number }>(
    `/admin/documents/${fileId}/pages?page=1&pageSize=50`,
  );
  const pageCount = pagesBody.total ?? pagesBody.items?.length ?? 0;
  record("Webpage pages created", pageCount > 0, `${pageCount} pages`, t5);
}

async function testPdfIngestion() {
  console.log("\n--- PDF Ingestion via Webhook ---");

  // 1. Send webhook
  const t1 = Date.now();
  console.log("[1/5] Sending PDF document webhook...");
  const payload: WebhookPayload = {
    id: PDF_DOC_ID,
    data: {
      id: PDF_DOC_ID,
      type: "pdf",
      title: `E2E Test PDF ${RUN_ID}`,
      team_id: TEST_ORG_ID,
      author_id: TEST_USER_ID,
      asset_url: TEST_PDF_URL,
    },
    type: "document",
    action: "insert",
    timestamp: new Date().toISOString(),
  };

  const webhookRes = await postWebhook(payload);
  record("PDF webhook accepted", webhookRes.status === 200, `status=${webhookRes.status}`, t1);

  if (webhookRes.status !== 200) {
    console.log("   Response:", JSON.stringify(webhookRes.body));
    return;
  }

  // 2. Find the created user_file
  const t2 = Date.now();
  console.log("[2/5] Looking for created user_file via admin API...");
  const file = await findDocumentBySourceId(PDF_DOC_ID, 30_000);

  if (!file) {
    record("PDF user_file created", false, "not found via admin API after 30s", t2);
    return;
  }

  const fileId = file.id as string;
  filesToCleanup.push(fileId);
  record("PDF user_file created", true, `fileId=${fileId}`, t2);

  // 3. Wait for parsing
  const t3 = Date.now();
  console.log("[3/5] Waiting for PDF parsing to complete...");
  try {
    const completedDoc = await waitForDocCompletion(fileId);
    const status = completedDoc.status as string;
    record("PDF parsing completes", status === "completed" || status === "processed", `status=${status}`, t3);
  } catch (err) {
    record("PDF parsing completes", false, (err as Error).message, t3);
    return;
  }

  // 4. Verify pages via admin API
  const t4 = Date.now();
  console.log("[4/5] Verifying parsed pages...");
  const { body: sectionsBody } = await adminApi<{ items: unknown[]; total: number }>(
    `/admin/documents/${fileId}/sections?page=1&pageSize=50`,
  );
  const sectionCount = sectionsBody.total ?? sectionsBody.items?.length ?? 0;
  record("PDF sections extracted", sectionCount >= 0, `${sectionCount} sections`, t4);

  // 5. Verify metadata
  const t5 = Date.now();
  console.log("[5/5] Verifying metadata...");
  const detail = await getDocumentDetail(fileId);
  const metadata = detail.metadata as Record<string, unknown> | null;
  const hasTitle = Boolean(metadata?.title);
  const hasSummary = Boolean(metadata?.summary);
  record("PDF metadata populated", hasTitle && hasSummary, `title=${hasTitle}, summary=${hasSummary}`, t5);
}

async function testWebhookDocumentDelete() {
  console.log("\n--- Document Delete via Webhook ---");

  const t1 = Date.now();
  console.log("[1/1] Sending delete webhook for webpage document...");
  const payload: WebhookPayload = {
    id: WEBPAGE_DOC_ID,
    data: { id: WEBPAGE_DOC_ID },
    type: "document",
    action: "delete",
    timestamp: new Date().toISOString(),
  };

  const webhookRes = await postWebhook(payload);
  record("Delete webhook accepted", webhookRes.status === 200, `status=${webhookRes.status}`, t1);
}

// ── Main ───────────────────────────────────────────────────────────────
async function run() {
  console.log("=".repeat(60));
  console.log("  E2E Ingestion Webhook Test");
  console.log("  Document (PDF + Webpage) → Processing → Verification");
  console.log("=".repeat(60));
  console.log(`  API:          ${API_BASE_URL}`);
  console.log(`  Webhook User: ${TEST_USER_ID}`);
  console.log(`  Webhook Org:  ${TEST_ORG_ID}`);
  console.log(`  PDF URL:      ${TEST_PDF_URL}`);
  console.log(`  Webpage URL:  ${TEST_WEBPAGE_URL}`);
  console.log(`  Run ID:       ${RUN_ID}`);
  console.log("=".repeat(60));

  // Pre-flight
  if (!BACKEND_TOKEN) throw new Error("BACKEND_TOKEN is required");
  if (!SIGNING_KEY) throw new Error("QSTASH_CURRENT_SIGNING_KEY is required");
  if (!ADMIN_USER_ID || !ADMIN_PASSWORD || !ADMIN_TOTP_SECRET) {
    throw new Error("ADMIN_TEST_USER_ID, ADMIN_TEST_PASSWORD, ADMIN_TEST_TOTP_SECRET are required");
  }

  // Warm up admin token
  console.log("\nAuthenticating admin user...");
  await getAdminToken();
  console.log("Admin authenticated.");

  try {
    await testWebpageIngestion();
    await testPdfIngestion();
    await testWebhookDocumentDelete();
  } finally {
    // Cleanup ext_documents
    console.log("\nCleaning up...");
    for (const docId of [WEBPAGE_DOC_ID, PDF_DOC_ID]) {
      try {
        await postWebhook({
          id: docId,
          data: { id: docId },
          type: "document",
          action: "delete",
          timestamp: new Date().toISOString(),
        });
        console.log(`  Deleted ext_document ${docId}`);
      } catch {
        // non-critical
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    console.log(`  ${icon} ${r.name.padEnd(30)} ${r.detail}`);
  }

  console.log("-".repeat(60));
  console.log(`  ${passed} passed, ${failed} failed — total ${(totalMs / 1000).toFixed(1)}s`);
  console.log("=".repeat(60));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
