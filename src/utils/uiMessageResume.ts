import { getMessages } from "@/db/queries/message";
import type { KnowsisUIMessage } from "@/utils/uiMessageBuilder";
import type { ReasoningUIPart, TextUIPart } from "ai";

export type ResumeStatus =
  /** No prior assistant message; treat as a normal first turn. */
  | { kind: "fresh" }
  /** Last assistant message finished cleanly. Nothing to resume. */
  | { kind: "complete"; assistant: KnowsisUIMessage }
  /** Crashed mid-text. The trailing text part has state: "streaming". */
  | { kind: "incomplete-text"; assistant: KnowsisUIMessage }
  /** A tool call has no `output-available` part yet. */
  | { kind: "incomplete-tool"; assistant: KnowsisUIMessage; toolCallId: string }
  /** Tool produced output but the model hasn't followed up with text. */
  | { kind: "tool-finished-no-followup"; assistant: KnowsisUIMessage };

export type ResumeContext = {
  history: KnowsisUIMessage[];
  status: ResumeStatus;
};

/**
 * Load a session's persisted messages and classify whether the last assistant
 * turn finished cleanly. Callers use the classification to decide whether to:
 *   - start a new turn (`fresh` / `complete`)
 *   - re-enter the loop seeded with the partial assistant (every other case)
 *
 * The helper is intentionally I/O-light: a single `getMessages` query plus
 * O(parts) inspection. Safe to call on every chat POST.
 */
export const loadForResume = async (sessionId: string): Promise<ResumeContext> => {
  const raw = await getMessages(sessionId);
  // The DB row type uses a generic UIMessagePart shape — narrow it back to
  // the application type at the boundary. The persisted JSON already conforms.
  const history = raw as unknown as KnowsisUIMessage[];

  if (history.length === 0) {
    return { history, status: { kind: "fresh" } };
  }

  const last = history[history.length - 1];
  if (last.role !== "assistant") {
    return { history, status: { kind: "fresh" } };
  }

  const status = classifyAssistant(last);
  return { history, status };
};

const classifyAssistant = (assistant: KnowsisUIMessage): ResumeStatus => {
  if (assistant.metadata?.finishReason) {
    return { kind: "complete", assistant };
  }

  // Walk parts in order; the *trailing* state of each block is what matters
  // for resume decisions.
  const tools = collectToolStates(assistant);
  const incompleteTool = tools.find((t) => t.state !== "output-available" && t.state !== "output-error");
  if (incompleteTool) {
    return { kind: "incomplete-tool", assistant, toolCallId: incompleteTool.toolCallId };
  }

  const trailingText = trailingStreamingBlock(assistant.parts, "text") as TextUIPart | undefined;
  if (trailingText) {
    return { kind: "incomplete-text", assistant };
  }
  const trailingReasoning = trailingStreamingBlock(assistant.parts, "reasoning") as ReasoningUIPart | undefined;
  if (trailingReasoning) {
    return { kind: "incomplete-text", assistant };
  }

  // All tools resolved, no streaming text, but no finishReason recorded.
  // This means the loop terminated between the last tool result and the
  // model's follow-up text — exactly the case where another LLM turn is
  // expected to summarise.
  if (tools.length > 0 && !hasTextAfterLastTool(assistant)) {
    return { kind: "tool-finished-no-followup", assistant };
  }

  return { kind: "complete", assistant };
};

type ToolPartShape = { type: `tool-${string}`; toolCallId: string; state: string };

const collectToolStates = (assistant: KnowsisUIMessage): ToolPartShape[] => {
  const result: ToolPartShape[] = [];
  for (const p of assistant.parts) {
    if (
      typeof p.type === "string" &&
      p.type.startsWith("tool-") &&
      "toolCallId" in p &&
      "state" in p
    ) {
      result.push({
        type: p.type as `tool-${string}`,
        toolCallId: (p as { toolCallId: string }).toolCallId,
        state: (p as { state: string }).state,
      });
    }
  }
  return result;
};

const trailingStreamingBlock = (
  parts: KnowsisUIMessage["parts"],
  type: "text" | "reasoning",
): TextUIPart | ReasoningUIPart | undefined => {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === type && (p as TextUIPart | ReasoningUIPart).state === "streaming") {
      return p as TextUIPart | ReasoningUIPart;
    }
  }
  return undefined;
};

const hasTextAfterLastTool = (assistant: KnowsisUIMessage): boolean => {
  let lastToolIdx = -1;
  for (let i = 0; i < assistant.parts.length; i++) {
    const p = assistant.parts[i];
    if (typeof p.type === "string" && p.type.startsWith("tool-")) lastToolIdx = i;
  }
  if (lastToolIdx < 0) return true;
  for (let i = lastToolIdx + 1; i < assistant.parts.length; i++) {
    if (assistant.parts[i].type === "text") return true;
  }
  return false;
};

/**
 * `true` when the resume status indicates the loop should run another turn.
 * Used by the route to gate whether to call into the agent loop or just
 * return the persisted history as-is.
 */
export const shouldResumeLoop = (status: ResumeStatus): boolean =>
  status.kind === "incomplete-text" ||
  status.kind === "incomplete-tool" ||
  status.kind === "tool-finished-no-followup";
