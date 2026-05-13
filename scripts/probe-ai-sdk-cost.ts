/**
 * Probe whether the Vercel AI SDK returns cost data directly.
 *
 * Exercises generateText + embedMany across providers and dumps every field
 * we might find pricing in: `usage`, `providerMetadata`, `response.headers`,
 * and the raw response body.
 *
 * Run: pnpm tsx scripts/probe-ai-sdk-cost.ts
 */

import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env") });

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { embedMany, generateText } from "ai";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

function dump(label: string, value: unknown) {
  // biome-ignore lint/suspicious/noConsole: probe script
  console.log(`\n=== ${label} ===`);
  // biome-ignore lint/suspicious/noConsole: probe script
  console.log(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );
}

async function probeGenerateText(label: string, model: Parameters<typeof generateText>[0]["model"]) {
  // biome-ignore lint/suspicious/noConsole: probe script
  console.log(`\n\n############ generateText :: ${label} ############`);
  const result = await generateText({
    model,
    prompt: "Reply with exactly: pong",
  });

  dump("usage", result.usage);
  dump("providerMetadata", result.providerMetadata);
  dump("response.headers", result.response?.headers);
  dump("response.modelId", result.response?.modelId);
  dump("response.body keys", result.response?.body ? Object.keys(result.response.body as object) : null);

  const all = Object.keys(result);
  dump("ALL top-level keys", all);
  for (const k of all) {
    const v = (result as Record<string, unknown>)[k];
    if (
      typeof v === "string" &&
      (v.toLowerCase().includes("cost") || v.toLowerCase().includes("usd"))
    ) {
      dump(`!! ${k} (contains cost/usd)`, v);
    }
  }
}

async function probeEmbed(label: string, embeddingModel: Parameters<typeof embedMany>[0]["model"]) {
  // biome-ignore lint/suspicious/noConsole: probe script
  console.log(`\n\n############ embedMany :: ${label} ############`);
  const result = await embedMany({
    model: embeddingModel,
    values: ["hello", "world"],
  });

  dump("usage", result.usage);
  dump(
    "providerMetadata",
    (result as { providerMetadata?: unknown }).providerMetadata,
  );
  dump(
    "responses",
    (result as { responses?: unknown }).responses,
  );
  dump("ALL top-level keys", Object.keys(result));
}

async function main() {
  try {
    await probeGenerateText("openai/gpt-4o-mini", openai("gpt-4o-mini"));
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: probe script
    console.error("openai generateText FAILED:", (e as Error).message);
  }

  try {
    await probeGenerateText("google/gemini-2.5-flash", google("gemini-2.5-flash"));
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: probe script
    console.error("google generateText FAILED:", (e as Error).message);
  }

  try {
    await probeEmbed("openai/text-embedding-3-small", openai.embedding("text-embedding-3-small"));
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: probe script
    console.error("openai embedMany FAILED:", (e as Error).message);
  }

  try {
    await probeEmbed(
      "google/gemini-embedding-001",
      google.textEmbedding("gemini-embedding-001"),
    );
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: probe script
    console.error("google embedMany FAILED:", (e as Error).message);
  }
}

main().catch((e) => {
  // biome-ignore lint/suspicious/noConsole: probe script
  console.error(e);
  process.exit(1);
});
