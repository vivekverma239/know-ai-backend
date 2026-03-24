/**
 * Smoke test for similarity search functions.
 * Tests that the DB queries execute without errors after the db/index.ts and migration changes.
 *
 * Usage: pnpm tsx test/simSearch.test.ts
 *
 * Requires: DATABASE_URL in .env
 */
import "dotenv/config";
import { performance } from "node:perf_hooks";
import {
  getSimilarChunks,
  getSimilarClusters,
  getSimilarDocuments,
  getSimilarChapters,
} from "../src/db/queries/simChunks";
import { getDb } from "../src/db";

// A dummy 768-dim embedding vector (zeros) — won't match anything meaningful
// but will exercise the full query path including cosineDistance
const DUMMY_EMBEDDING = new Array(768).fill(0.01);

const TEST_USER_ID = process.env.TEST_USER_ID || "test-user-000";
const TEST_ORG_ID = process.env.TEST_ORG_ID || "test-org-000";

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  rowCount: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<unknown[]>) {
  const start = performance.now();
  try {
    const rows = await fn();
    const duration = Math.round(performance.now() - start);
    results.push({ name, success: true, duration, rowCount: rows.length });
    console.log(`  ✅ ${name} — ${rows.length} rows in ${duration}ms`);
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    const msg = error instanceof Error ? error.message : String(error);
    results.push({ name, success: false, duration, rowCount: 0, error: msg });
    console.log(`  ❌ ${name} — ${msg} (${duration}ms)`);
  }
}

async function main() {
  console.log("\n🔍 Similarity Search Smoke Tests\n");

  // Test 0: Verify DB connection works (getDb caching fix)
  console.log("--- DB Connection ---");
  await runTest("getDb() returns same instance", async () => {
    const db1 = getDb();
    const db2 = getDb();
    if (db1 !== db2) throw new Error("getDb() returned different instances — caching is broken");
    return [];
  });

  // Test 1: getSimilarChunks
  console.log("\n--- getSimilarChunks ---");
  await runTest("chunks: basic query with user scope", async () => {
    return getSimilarChunks({
      embedding: DUMMY_EMBEDDING,
      userId: TEST_USER_ID,
      orgId: TEST_ORG_ID,
      limit: 5,
      page: 1,
    });
  });

  await runTest("chunks: with documentIds filter", async () => {
    return getSimilarChunks({
      embedding: DUMMY_EMBEDDING,
      userId: TEST_USER_ID,
      orgId: TEST_ORG_ID,
      documentIds: ["00000000-0000-0000-0000-000000000000"],
      limit: 5,
    });
  });

  await runTest("chunks: with excludeChunkIds", async () => {
    return getSimilarChunks({
      embedding: DUMMY_EMBEDDING,
      userId: TEST_USER_ID,
      orgId: TEST_ORG_ID,
      excludeChunkIds: ["00000000-0000-0000-0000-000000000000"],
      limit: 5,
    });
  });

  await runTest("chunks: without user scope (no userId/orgId)", async () => {
    return getSimilarChunks({
      embedding: DUMMY_EMBEDDING,
      limit: 5,
    });
  });

  // Test 2: getSimilarClusters
  console.log("\n--- getSimilarClusters ---");
  await runTest("clusters: basic query", async () => {
    return getSimilarClusters({
      embedding: DUMMY_EMBEDDING,
      userId: TEST_USER_ID,
      orgId: TEST_ORG_ID,
      limit: 5,
    });
  });

  // Test 3: getSimilarDocuments
  console.log("\n--- getSimilarDocuments ---");
  await runTest("documents: basic query", async () => {
    return getSimilarDocuments({
      embedding: DUMMY_EMBEDDING,
      userId: TEST_USER_ID,
      orgId: TEST_ORG_ID,
      limit: 5,
    });
  });

  // Test 4: getSimilarChapters
  console.log("\n--- getSimilarChapters ---");
  await runTest("chapters: basic query", async () => {
    return getSimilarChapters({
      embedding: DUMMY_EMBEDDING,
      userId: TEST_USER_ID,
      orgId: TEST_ORG_ID,
      limit: 5,
    });
  });

  // Summary
  console.log("\n===========================");
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`Results: ${passed} passed, ${failed} failed out of ${results.length} tests`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    }
    process.exit(1);
  }

  console.log("\n✅ All similarity search tests passed!\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
