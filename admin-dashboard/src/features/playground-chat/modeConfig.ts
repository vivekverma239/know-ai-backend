import { DefaultChatTransport } from "ai";
import { API_BASE_URL } from "@/lib/api";

export type ChatMode = "finAgent" | "knowledgeBase" | "agentSearch";

type ModeConfig = {
  label: string;
  endpoint: string;
  bodyExtra: () => Record<string, unknown>;
  suggestions: string[];
};

export const MODES: Record<ChatMode, ModeConfig> = {
  finAgent: {
    label: "FinAgent (admin playground)",
    endpoint: "/admin/playground/chat",
    bodyExtra: () => ({}),
    suggestions: [
      "Summarize this user's recent activity",
      "What reports has this user generated this quarter?",
      "Run a market check on the user's tracked entities",
      "Show me the latest news for this user's portfolio",
    ],
  },
  knowledgeBase: {
    label: "Knowledge Base (/api/v1/chat)",
    endpoint: "/admin/playground/chat-stream",
    bodyExtra: () => ({ deepSearch: "knowledgeBase" }),
    suggestions: [
      "What documents are in this user's knowledge base?",
      "Find recent earnings call mentions of margin pressure",
      "Pull key takeaways from the most recent uploaded report",
      "Search the knowledge base for ESG-related disclosures",
    ],
  },
  agentSearch: {
    label: "Deep Search (/api/v1/chat)",
    endpoint: "/admin/playground/chat-stream",
    bodyExtra: () => ({ deepSearch: "agentSearch" }),
    suggestions: [
      "Deep research the latest macro outlook for tech",
      "Find primary sources on rate-cut expectations this quarter",
      "Compare analyst views on AI capex this month",
      "Investigate supply chain disruptions in semiconductors",
    ],
  },
};

export type TransportContext = {
  accessToken: string | null;
  userId: string;
  orgId: string;
  sessionId: string;
  /** Per-mode extras (e.g. FinAgent model overrides) merged into the body. */
  extraBody?: Record<string, unknown>;
};

export function buildTransport(mode: ChatMode, ctx: TransportContext) {
  const { accessToken, userId, orgId, sessionId, extraBody } = ctx;
  const cfg = MODES[mode];
  return new DefaultChatTransport({
    api: `${API_BASE_URL}${cfg.endpoint}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    body: { userId, orgId, sessionId, ...cfg.bodyExtra(), ...extraBody },
  });
}
