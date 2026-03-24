import { describe, it, expect, beforeAll } from "vitest";
import { api, requireEnv } from "../helpers";
import { v4 as uuidv4 } from "uuid";

interface ChatSession {
  id: string;
  title: string;
}

interface SessionListResponse {
  sessions: ChatSession[];
  cursor?: string;
}

interface SessionDetailResponse {
  session: ChatSession;
  messages: unknown[];
}

describe("Chat Sessions", () => {
  beforeAll(() => requireEnv());
  let sessionId: string;

  describe("POST /chat-session", () => {
    it("creates a new session", async () => {
      const id = uuidv4();
      const res = await api<ChatSession>("/chat-session", {
        method: "POST",
        body: JSON.stringify({ id, title: "E2E Test Session" }),
      });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id", id);
      expect(res.body).toHaveProperty("title", "E2E Test Session");
      sessionId = id;
    });

    it("creates session with generated id when none provided", async () => {
      const res = await api<ChatSession>("/chat-session", {
        method: "POST",
        body: JSON.stringify({ title: "Auto ID Session" }),
      });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
    });
  });

  describe("GET /chat-session", () => {
    it("lists sessions with cursor pagination", async () => {
      const res = await api<SessionListResponse>("/chat-session?limit=10");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("sessions");
      expect(Array.isArray(res.body.sessions)).toBe(true);
    });
  });

  describe("GET /chat-session/:id", () => {
    it("returns session with messages", async () => {
      const res = await api<SessionDetailResponse>(
        `/chat-session/${sessionId}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("session");
      expect(res.body).toHaveProperty("messages");
    });

    it("returns 404 for non-existent session", async () => {
      const res = await api(`/chat-session/${uuidv4()}`);
      expect(res.status).toBe(404);
    });
  });
});
