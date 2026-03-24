import { describe, it, expect, beforeAll } from "vitest";
import { api, requireEnv } from "../helpers";
import { v4 as uuidv4 } from "uuid";

describe("Web Search Tasks", () => {
  beforeAll(() => requireEnv());

  describe("POST /agent/web-search/tasks", () => {
    it("creates a web search task", async () => {
      const res = await api("/agent/web-search/tasks", {
        method: "POST",
        body: JSON.stringify({ query: "test search query" }),
      });
      // May return 201 or 503 (if QStash not configured)
      expect([201, 202, 503]).toContain(res.status);
    });
  });

  describe("GET /agent/web-search/tasks", () => {
    it("lists tasks for the user", async () => {
      const res = await api("/agent/web-search/tasks");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});

describe("Structured Reports", () => {
  beforeAll(() => requireEnv());
  let templateId: string;

  describe("POST /report/templates", () => {
    it("creates a report template", async () => {
      const res = await api("/report/templates", {
        method: "POST",
        body: JSON.stringify({
          title: "E2E Test Template",
          taskDescription: "Test task description",
          prompts: {
            initialResearchPrompt: "Research the topic",
            subQuestionsIdentificationPrompt: "Identify sub questions",
            finalReportPrompt: "Write final report",
          },
        }),
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      templateId = (res.body as any).id;
    });
  });

  describe("GET /report/templates", () => {
    it("lists templates", async () => {
      const res = await api("/report/templates");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect((res.body as any[]).length).toBeGreaterThan(0);
    });
  });

  describe("GET /report/reports", () => {
    it("lists reports for user", async () => {
      const res = await api("/report/reports");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("GET /report/reports/:id", () => {
    it("returns 404 for non-existent report", async () => {
      const res = await api(`/report/reports/${uuidv4()}`);
      expect(res.status).toBe(404);
    });
  });
});

describe("Analytics", () => {
  beforeAll(() => requireEnv());

  describe("GET /analytics/token-usage/summary", () => {
    it("returns usage summary", async () => {
      const res = await api("/analytics/token-usage/summary");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("summary");
      expect(res.body).toHaveProperty("totals");
    });
  });

  describe("GET /analytics/token-usage/by-user", () => {
    it("returns per-user usage", async () => {
      const res = await api("/analytics/token-usage/by-user");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("users");
    });
  });

  describe("GET /analytics/token-usage/by-operation", () => {
    it("returns per-operation usage", async () => {
      const res = await api("/analytics/token-usage/by-operation");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("operations");
    });
  });
});
