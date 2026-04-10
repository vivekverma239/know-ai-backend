import type { MiddlewareHandler } from "hono";

export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.warn("API_KEY env var not set — auth disabled");
      return next();
    }

    const provided = c.req.header("X-API-Key");
    if (!provided || provided !== apiKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return next();
  };
}
