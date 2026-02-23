import "dotenv/config";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { v4 as uuidv4 } from "uuid";

// Config
const API_BASE_URL =
  process.env.API_BASE_URL || "http://localhost:3000/api/v1";
const BACKEND_TOKEN = process.env.BACKEND_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const USER_COUNT = Number(process.env.SMOKE_TEST_USER_COUNT) || 3;

interface SmokeUser {
  userId: string;
  orgId: string;
  email: string;
  name: string;
}

interface TestResult {
  endpoint: string;
  method: string;
  success: boolean;
  status: number | null;
  duration: number;
  error?: string;
}

// ── DB: fetch random users ──────────────────────────────────────────

async function fetchRandomUsers(count: number): Promise<SmokeUser[]> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

  const conn = postgres(DATABASE_URL);
  const db = drizzle(conn);

  try {
    const rows = await db.execute<{
      user_id: string;
      account_id: string;
      email: string;
      name: string;
    }>(sql`
      SELECT
        m.user_id,
        m.account_id,
        COALESCE(a.email, 'smoke-test@example.com') AS email,
        COALESCE(a.name, 'Smoke Test User') AS name
      FROM ext_accounts_memberships m
      JOIN ext_accounts a ON a.id = m.account_id
      WHERE a.is_personal_account = false
      ORDER BY random()
      LIMIT ${count}
    `);

    return rows.map((r) => ({
      userId: r.user_id,
      orgId: r.account_id,
      email: r.email,
      name: r.name,
    }));
  } finally {
    await conn.end();
  }
}

// ── HTTP helper ─────────────────────────────────────────────────────

async function testEndpoint(
  user: SmokeUser,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<TestResult> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-user-id": user.userId,
    "x-org-id": user.orgId,
    "x-user-email": user.email,
    "x-user-name": user.name,
    authorization: `Bearer ${BACKEND_TOKEN}`,
  };

  const start = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const duration = Math.round(performance.now() - start);
    const ok = res.status >= 200 && res.status < 300;

    if (!ok) {
      const text = await res.text().catch(() => "");
      return {
        endpoint: `${method} ${path}`,
        method,
        success: false,
        status: res.status,
        duration,
        error: `${res.status} – ${text.slice(0, 200)}`,
      };
    }

    return {
      endpoint: `${method} ${path}`,
      method,
      success: true,
      status: res.status,
      duration,
    };
  } catch (err) {
    return {
      endpoint: `${method} ${path}`,
      method,
      success: false,
      status: null,
      duration: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Per-user test suite ─────────────────────────────────────────────

async function runTestsForUser(user: SmokeUser): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const run = async (
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ) => {
    const r = await testEndpoint(user, method, path, body);
    const icon = r.success ? "✓" : "✗";
    const tag = r.success ? "" : ` [${r.error}]`;
    console.log(
      `  ${icon} ${r.endpoint} (${r.status ?? "ERR"}, ${r.duration}ms)${tag}`,
    );
    results.push(r);
    return r;
  };

  // 1. Health
  await run("GET", "/health");

  // 2. Create session
  const sessionId = uuidv4();
  const createRes = await run("POST", "/chat-session", {
    id: sessionId,
    title: `Smoke test ${new Date().toISOString()}`,
  });

  // 3. List sessions
  await run("GET", "/chat-session");

  // 4. Get the session we just created (only if creation succeeded)
  if (createRes.success) {
    await run("GET", `/chat-session/${sessionId}`);
  }

  // 5. List files
  await run("GET", "/files");

  // 6. Web search tasks
  await run("GET", "/agent/web-search/tasks");

  // 7. Report templates
  await run("GET", "/report/templates");

  // 8. Reports
  await run("GET", "/report/reports");

  // 9. Token usage summary (no auth needed, but we send it anyway)
  await run("GET", "/analytics/token-usage/summary");

  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("Smoke Test");
  console.log("=".repeat(50));
  console.log(`API:   ${API_BASE_URL}`);
  console.log(`Users: ${USER_COUNT}`);
  console.log(`Token: ${BACKEND_TOKEN ? "set" : "MISSING"}`);
  console.log();

  if (!BACKEND_TOKEN) {
    console.error("BACKEND_TOKEN is required");
    process.exit(1);
  }

  // Fetch real users
  const users = await fetchRandomUsers(USER_COUNT);
  console.log(`Fetched ${users.length} random users from DB\n`);

  if (users.length === 0) {
    console.error("No users found in ext_accounts_memberships. Aborting.");
    process.exit(1);
  }

  const allResults: TestResult[] = [];

  for (const user of users) {
    console.log(
      `Testing user ${user.userId} (org: ${user.orgId}, ${user.name})...`,
    );
    const results = await runTestsForUser(user);
    allResults.push(...results);
    console.log();
  }

  // Summary
  const passed = allResults.filter((r) => r.success).length;
  const total = allResults.length;

  console.log("=".repeat(50));
  console.log(`Summary: ${passed}/${total} passed`);

  if (passed < total) {
    console.log("\nFailed:");
    for (const r of allResults.filter((r) => !r.success)) {
      console.log(`  ${r.endpoint}: ${r.error}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
