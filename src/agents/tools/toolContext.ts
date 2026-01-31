import type { MODELS } from "@/@types/llm";
import type { LanguageModelUsage, UIMessageStreamWriter } from "ai";
import type { FinAgentUIMessage } from "../finAgent";
// import type { FinAgentUIMessage } from "../fin/finAgent"; // Circular dependency potentially. Use any for now or move type.
// Simplified context for now
export type ToolContext = {
  userId: string;
  orgId: string;
  sessionId: string;
  writer?: UIMessageStreamWriter<FinAgentUIMessage>;
  addUsage?: (addUsage: { usage: LanguageModelUsage; model: string }) => void;
};
