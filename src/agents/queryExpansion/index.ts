import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import { generateText } from "ai";
import moment from "moment";

const systemPrompt = `
You are given a question by an expert financial analyst, your job is to rephrase
the quesion and add additional context to make it more understandable to a
junior analyst. Make sure to add tips/expand on query/add any other details
that might be needed. You can also break it down into multiple steps (but only if really needed).
Just return the final output and no additional text, don't mention it's for a junior analyst or anything else.

Assume you have access to all required documents, no need to search the internet,
Do not ask follow up questions, do not include sanity checks.
Do not include tips on how to present the output.
Clarify the dates and entities when needed.

IMPORTANT: Be very concise, use maximum 20-25 times the characters of the original question.
Today is ${moment().format("YYYY-MM-DD")}.
`;

const systemPrompt2 = `the following is a question by a financial practitioner to her junior analyst, rephrase the question to make it more understandable to the junior analyst. If needed, break it down in more sub-questions and / or give hints and suggestions. Today is ${moment().format(
  "YYYY-MM-DD",
)}. Assume you have access to all required documents, no need to search the internet, do not ask follow up questions, do not include sanity checks. Do not include tips on how to present the output. IMPORTANT: be very concise.`;

export const queryExpansion = async (query: string) => {
  // const model = MODELS.CLAUDE_4_SONNET;
  const model = MODELS.GPT_5;

  const llm = getLLM(model);
  const response = await generateText({
    model: llm,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
    providerOptions: {
      openai: {
        reasoningEffort: "low",
        textVerbosity: "low",
      },
    },
    temperature: 1,
  });
  return response.text;
};
