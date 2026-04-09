import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://dev-lara-admin.up.railway.app",
];

const parseAllowedOrigins = () => {
  const allowedOrigins = new Set(DEFAULT_ALLOWED_ORIGINS);
  const configured = process.env.CORS_ORIGIN;
  if (!configured || configured.trim() === "") {
    return allowedOrigins;
  }
  for (const origin of configured.split(",")) {
    const normalizedOrigin = origin.trim();
    if (normalizedOrigin.length > 0) {
      allowedOrigins.add(normalizedOrigin);
    }
  }
  return allowedOrigins;
};

const isLoopbackOrigin = (origin: string) => {
  try {
    const parsed = new URL(origin);
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    const isLoopbackHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    return isHttp && isLoopbackHost;
  } catch {
    return false;
  }
};

const corsPlugin = async (fastify: FastifyInstance) => {
  const allowedOrigins = parseAllowedOrigins();
  await fastify.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      if (process.env.ENV !== "prod" && isLoopbackOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed"), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "x-user-id",
      "x-org-id",
      "x-user-email",
      "x-user-name",
    ],
    credentials: false,
    maxAge: 86400,
  });
};

export default fp(corsPlugin, {
  name: "cors-plugin",
  fastify: "5.x",
});
