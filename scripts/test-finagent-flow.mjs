/**
 * E2E test for the FinAgent web-search + bulk-indexing flow against the local
 * backend. Mints an admin JWT from ADMIN_JWT_SECRET, sends a UIMessage to
 * /admin/playground/chat, and prints every SSE chunk so we can watch the tool
 * sequence and any ⚠️ surfaced errors.
 *
 * Usage: node --env-file=.env /tmp/test-finagent-flow.mjs
 */
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const API = "http://localhost:3100/api/v1";
const USER_ID = "558f72a3-13ab-481b-b91c-001de87aa297";
const ORG_ID = "5b65c553-86bb-417c-a37d-4700ddabaf0f";
const PROMPT = process.argv[2] ??
  "Find a recent quarterly earnings report (10-Q) for Apple from sec.gov and add it to my knowledge base.";

const secret = process.env.ADMIN_JWT_SECRET;
if (!secret) throw new Error("ADMIN_JWT_SECRET not set");

const jwt = await new SignJWT({
  tokenType: "admin_access",
  userId: "test-admin",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("8h")
  .sign(new TextEncoder().encode(secret));

const sessionId = randomUUID();
console.log(`[test] sessionId=${sessionId}`);
console.log(`[test] prompt: ${PROMPT}\n`);

const res = await fetch(`${API}/admin/playground/chat`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${jwt}`,
  },
  body: JSON.stringify({
    userId: USER_ID,
    orgId: ORG_ID,
    sessionId,
    webSearch: true,
    messages: [
      {
        id: randomUUID(),
        role: "user",
        parts: [{ type: "text", text: PROMPT }],
      },
    ],
  }),
});

if (!res.ok) {
  console.error(`[test] HTTP ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let toolStarted = new Set();

const summarize = (chunk) => {
  switch (chunk.type) {
    case "start":
      return `start id=${chunk.messageId} agent=${chunk.messageMetadata?.agent}`;
    case "start-step":
      return "→ step start";
    case "finish-step":
      return "← step end";
    case "text-start":
      return `[text-start ${chunk.id}]`;
    case "text-delta":
      return chunk.delta?.length > 60
        ? `[text Δ ${chunk.delta.length}b] ${chunk.delta.slice(0, 60)}…`
        : `[text Δ] ${chunk.delta}`;
    case "text-end":
      return `[text-end ${chunk.id}]`;
    case "tool-input-start": {
      toolStarted.add(chunk.toolCallId);
      return `🔧 ${chunk.toolName} (start)`;
    }
    case "tool-call":
      return `🔧 ${chunk.toolName} input=${JSON.stringify(chunk.input).slice(0, 200)}`;
    case "tool-result": {
      const out = JSON.stringify(chunk.output);
      return `✅ tool-result ${chunk.toolCallId.slice(-8)} ${out.length > 200 ? `${out.slice(0, 200)}… (${out.length}b)` : out}`;
    }
    case "tool-error":
      return `❌ tool-error ${chunk.toolCallId.slice(-8)}: ${chunk.errorText ?? chunk.error}`;
    case "finish":
      return `finish reason=${chunk.finishReason} usage=${JSON.stringify(chunk.messageMetadata?.usage ?? {})}`;
    case "message-metadata":
      return `[metadata] ${JSON.stringify(chunk.messageMetadata).slice(0, 200)}`;
    default:
      return `[${chunk.type}] ${JSON.stringify(chunk).slice(0, 120)}`;
  }
};

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const block = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    for (const line of block.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") {
        console.log("\n[test] [DONE]");
        process.exit(0);
      }
      try {
        const chunk = JSON.parse(data);
        console.log(summarize(chunk));
      } catch (err) {
        console.log(`[parse-error] ${data.slice(0, 100)}`);
      }
    }
  }
}
