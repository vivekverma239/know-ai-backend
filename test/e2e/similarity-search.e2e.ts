import { describe, it, expect, beforeAll } from "vitest";
import {
  getSimilarChunks,
  getSimilarClusters,
  getSimilarDocuments,
  getSimilarChapters,
} from "../../src/db/queries/simChunks";
import { getDb } from "../../src/db";

// Dummy 768-dim embedding (non-zero to avoid degenerate cosine)
const DUMMY_EMBEDDING = new Array(768).fill(0.01);
const TEST_USER_ID = process.env.TEST_USER_ID || "test-user-000";
const TEST_ORG_ID = process.env.TEST_ORG_ID || "test-org-000";

describe("Similarity Search (DB layer)", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL required for similarity search tests");
    }
  });

  describe("getDb()", () => {
    it("returns the same cached instance", () => {
      const db1 = getDb();
      const db2 = getDb();
      expect(db1).toBe(db2);
    });
  });

  describe("getSimilarChunks", () => {
    it("executes with user scope", async () => {
      const results = await getSimilarChunks({
        embedding: DUMMY_EMBEDDING,
        userId: TEST_USER_ID,
        orgId: TEST_ORG_ID,
        limit: 5,
      });
      expect(Array.isArray(results)).toBe(true);
      for (const chunk of results) {
        expect(chunk).toHaveProperty("content");
        expect(chunk).toHaveProperty("similarity");
        expect(chunk).toHaveProperty("documentId");
        expect(typeof chunk.similarity).toBe("number");
      }
    });

    it("executes with documentIds filter", async () => {
      const results = await getSimilarChunks({
        embedding: DUMMY_EMBEDDING,
        userId: TEST_USER_ID,
        orgId: TEST_ORG_ID,
        documentIds: ["00000000-0000-0000-0000-000000000000"],
        limit: 5,
      });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0); // non-existent doc
    });

    it("executes with excludeChunkIds", async () => {
      const results = await getSimilarChunks({
        embedding: DUMMY_EMBEDDING,
        userId: TEST_USER_ID,
        orgId: TEST_ORG_ID,
        excludeChunkIds: ["00000000-0000-0000-0000-000000000000"],
        limit: 5,
      });
      expect(Array.isArray(results)).toBe(true);
    });

    it("executes without user scope", async () => {
      const results = await getSimilarChunks({
        embedding: DUMMY_EMBEDDING,
        limit: 5,
      });
      expect(Array.isArray(results)).toBe(true);
      // Should return results from all users (no access filter)
    });

    it("respects limit parameter", async () => {
      const results = await getSimilarChunks({
        embedding: DUMMY_EMBEDDING,
        limit: 2,
      });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getSimilarClusters", () => {
    it("executes with user scope", async () => {
      const results = await getSimilarClusters({
        embedding: DUMMY_EMBEDDING,
        userId: TEST_USER_ID,
        orgId: TEST_ORG_ID,
        limit: 5,
      });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("getSimilarDocuments", () => {
    it("executes with user scope", async () => {
      const results = await getSimilarDocuments({
        embedding: DUMMY_EMBEDDING,
        userId: TEST_USER_ID,
        orgId: TEST_ORG_ID,
        limit: 5,
      });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("getSimilarChapters", () => {
    it("executes with user scope", async () => {
      const results = await getSimilarChapters({
        embedding: DUMMY_EMBEDDING,
        userId: TEST_USER_ID,
        orgId: TEST_ORG_ID,
        limit: 5,
      });
      expect(Array.isArray(results)).toBe(true);
    });

    it("supports pagination", async () => {
      const page1 = await getSimilarChapters({
        embedding: DUMMY_EMBEDDING,
        limit: 2,
        page: 1,
      });
      const page2 = await getSimilarChapters({
        embedding: DUMMY_EMBEDDING,
        limit: 2,
        page: 2,
      });
      expect(Array.isArray(page1)).toBe(true);
      expect(Array.isArray(page2)).toBe(true);
    });
  });
});
