/**
 * Standalone reproduction of the FinAgent image-attachment empty-stream bug.
 *
 * Sends a UIMessage with an image data-URL through `streamText` against
 * `gemini-3-flash-preview` and prints every fullStream chunk so we can see
 * whether the model errors, returns nothing, or emits real output.
 *
 * Usage:
 *   GOOGLE_GENERATIVE_AI_API_KEY=... node scripts/check-finagent-image.mjs
 */
import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, streamText } from "ai";
import fs from "node:fs";

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_GENERATIVE_AI_API_KEY not set");
  process.exit(1);
}

const google = createGoogleGenerativeAI({ apiKey });

const imagePath = process.argv[2] ?? "/tmp/finagent-test1.png";
if (!fs.existsSync(imagePath)) {
  console.error(`Image not found at ${imagePath}`);
  process.exit(1);
}

const base64 = fs.readFileSync(imagePath).toString("base64");
const dataUrl = `data:image/png;base64,${base64}`;

const uiMessages = [
  {
    id: "u1",
    role: "user",
    parts: [
      { type: "file", url: dataUrl, mediaType: "image/png" },
      { type: "text", text: "What do you see in this image? Describe it briefly." },
    ],
  },
];

const modelMessages = await convertToModelMessages(uiMessages);

console.log("=== ModelMessages preview ===");
console.log(
  JSON.stringify(
    modelMessages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content.slice(0, 80)
          : m.content.map((p) => ({
              type: p.type,
              ...(p.type === "text" ? { text: p.text.slice(0, 80) } : {}),
              ...(p.type === "file"
                ? {
                    mediaType: p.mediaType,
                    dataPrefix: typeof p.data === "string" ? p.data.slice(0, 30) : "<binary>",
                    dataLength: typeof p.data === "string" ? p.data.length : p.data?.byteLength,
                  }
                : {}),
            })),
    })),
    null,
    2,
  ),
);

console.log("\n=== Calling streamText with gemini-3-flash-preview ===");

const result = streamText({
  model: google("gemini-3-flash-preview"),
  messages: modelMessages,
});

let chunkCount = 0;
let textBytes = 0;
const types = new Map();
try {
  for await (const chunk of result.fullStream) {
    chunkCount += 1;
    types.set(chunk.type, (types.get(chunk.type) ?? 0) + 1);
    if (chunk.type === "text-delta") textBytes += chunk.text.length;
    if (chunk.type === "error") {
      console.error("[error chunk]", chunk.error);
    }
    if (chunkCount <= 50) {
      console.log(
        `[${chunk.type}]`,
        chunk.type === "text-delta" ? chunk.text.slice(0, 80) : "",
      );
    }
  }
} catch (err) {
  console.error("\n=== Iteration threw ===");
  console.error(err);
}

console.log("\n=== Summary ===");
console.log("chunks:", chunkCount);
console.log("text bytes:", textBytes);
console.log("types:", Object.fromEntries(types));
