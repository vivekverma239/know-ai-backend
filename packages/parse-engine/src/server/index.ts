import { OpenAPIHono } from "@hono/zod-openapi";
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apiKeyAuth } from "./middleware/auth.js";
import { healthApp } from "./routes/health.js";
import { parseApp } from "./routes/parse.js";
import { workflowHandler } from "./workflow.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = new OpenAPIHono();

// Auth for all routes except health and workflow callback
app.use("/parse/*", apiKeyAuth());
app.use("/parse-any", apiKeyAuth());
app.use("/download", apiKeyAuth());

// Mount routes
app.route("/", healthApp);
app.route("/", parseApp);
app.post("/workflow", workflowHandler);

// OpenAPI spec + Swagger UI
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Parse Engine API",
    version: "1.0.0",
    description: "Standalone document parsing service powered by parse-engine",
  },
});

// /llms.txt — canonical API reference for LLMs and integrators.
// See https://llmstxt.org. Served from the package root regardless of whether
// we are running tsx (src/) or compiled output (dist/).
const LLMS_TXT_CANDIDATES = [
  join(__dirname, "../../llms.txt"),        // dist/server/index.js → packages/parse-engine/llms.txt
  join(__dirname, "../../../llms.txt"),     // src/server/index.ts via tsx → same target
  join(process.cwd(), "packages/parse-engine/llms.txt"),
  join(process.cwd(), "llms.txt"),
];

let llmsTxtContent: string | null = null;
for (const candidate of LLMS_TXT_CANDIDATES) {
  try {
    llmsTxtContent = readFileSync(candidate, "utf-8");
    break;
  } catch {
    /* try next */
  }
}

app.get("/llms.txt", (c) => {
  if (!llmsTxtContent) return c.text("llms.txt not found", 404);
  return c.text(llmsTxtContent, 200, { "content-type": "text/plain; charset=utf-8" });
});

app.get("/docs", (c) => {
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <title>Parse Engine API</title>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" });</script>
</body>
</html>`);
});

const port = Number(process.env.PORT ?? 3001);
console.log(`Parse Engine server starting on port ${port}`);
serve({ fetch: app.fetch, port });

export default app;
