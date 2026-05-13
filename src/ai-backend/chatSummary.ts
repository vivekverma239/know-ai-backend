import { MODELS } from "@/@types/llm";
import { recordUsageFromSdk } from "@/utils/costTracker";
import type { LanguageModel, ModelMessage } from "ai";
import { generateText } from "ai";
import { getLLM } from "./llm";

const PROMPT = `
You are a helpful assistant that summarizes conversations. Given a chat hitory
summarize the conversation and give it a short title. Output only the title and
nothing else.

Conversation history:
{{conversationHistory}}
`;

export const summarizeChat = async (sessionId: string, messages: ModelMessage[]) => {
  const model = MODELS.GEMINI_2_0_FLASH;
  const llm = getLLM(model);
  const result = await generateText({
    model: llm as LanguageModel,
    prompt: PROMPT.replace(
      "{{conversationHistory}}",
      messages.map((m: ModelMessage) => `${m.role}: ${JSON.stringify(m.content)}`).join("\n"),
    ),
  });

  recordUsageFromSdk({
    operationName: "summarizeChat",
    source: "chat",
    model,
    usage: result.usage,
    metadata: { sessionId },
  });

  return result.text;
};
