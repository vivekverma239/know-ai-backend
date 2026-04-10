import { OpenAPIHono } from "@hono/zod-openapi";
import { serve } from "@hono/node-server";
import { apiKeyAuth } from "./middleware/auth.js";
import { healthApp } from "./routes/health.js";
import { parseApp } from "./routes/parse.js";
import { workflowHandler } from "./workflow.js";

const app = new OpenAPIHono();

// Auth for all routes except health and workflow callback
app.use("/parse/*", apiKeyAuth());

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
