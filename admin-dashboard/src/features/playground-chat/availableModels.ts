// Models surfaced in the FinAgent playground selectors. The IDs must match
// values in the backend `MODELS` enum (src/@types/llm.ts) so the route can
// pass them straight to `getLLM()`.

export type ModelOption = { id: string; label: string };

// Tool-calling driver for the FinAgent step loop. Defaults to gpt-5.5 to
// match the backend default.
export const AGENT_MODELS: ModelOption[] = [
  { id: "gpt-5.5-2026-04-23", label: "GPT-5.5" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 Mini" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "anthropic/claude-sonnet-4", label: "Claude 4 Sonnet" },
  { id: "x-ai/grok-4", label: "Grok 4" },
];

// Single-shot QA model used inside `fileAnswerTool`. Defaults to gemini-3-flash.
export const FILE_ANSWER_MODELS: ModelOption[] = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
  { id: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast" },
  { id: "gpt-5-mini", label: "GPT-5 Mini" },
  { id: "gpt-5-nano", label: "GPT-5 Nano" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite-preview-06-17", label: "Gemini 2.5 Flash Lite" },
];

export const DEFAULT_AGENT_MODEL = AGENT_MODELS[0].id;
export const DEFAULT_FILE_ANSWER_MODEL = FILE_ANSWER_MODELS[0].id;
