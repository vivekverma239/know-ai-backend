import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HealthResponse } from "../schemas.js";

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Health check",
  responses: {
    200: {
      description: "Server is healthy",
      content: { "application/json": { schema: HealthResponse } },
    },
  },
});

export const healthApp = new OpenAPIHono();

healthApp.openapi(healthRoute, (c) => {
  return c.json({ status: "ok" as const, timestamp: new Date().toISOString() }, 200);
});
