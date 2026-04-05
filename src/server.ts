import dotenv from "dotenv";
dotenv.config();
// Initialize OpenTelemetry FIRST before any other imports
// This ensures auto-instrumentation works properly
import { initializeOpenTelemetry } from "@/utils/otel";
initializeOpenTelemetry();

import { logger } from "@/utils/logger";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";

import swaggerUI from "@fastify/swagger-ui";
// import multipartPlugin from "./plugins/multipart.plugin";
import adminAuthPlugin from "./plugins/adminAuth.plugin";
import authPlugin from "./plugins/auth.plugin";
import corsPlugin from "./plugins/cors.plugin";
import loggingPlugin from "./plugins/logging.plugin";
import { createErrorHandler } from "./utils/errorHandler";

import adminAuthRoutes from "./routes/adminAuth.routes";
import adminRoutes from "./routes/admin.routes";
import adminPlaygroundRoutes from "./routes/adminPlayground.routes";
import analyticsRoutes from "./routes/analytics.routes";
import chatRoutes from "./routes/chatSession.routes";
import chatStreamRoutes from "./routes/chatStream.routes";
import fileRoutes from "./routes/file.routes";
import finAgentRoutes from "./routes/finAgent.routes";
import healthRoutes from "./routes/health.routes";
import ingestionRoutes from "./routes/ingestion.routes";
import parsingCallbackRoutes from "./routes/parsingCallback.routes";
import structuredReportRoutes from "./routes/structuredReport.routes";
import structuredReportCallbackRoutes from "./routes/structuredReportCallback.routes";
import webSearchRoutes from "./routes/webSearch.routes";
import tocMetaCallbackRoutes from "./routes/tocMetaCallback.routes";
import documentParseCallbackRoutes from "./routes/documentParseCallback.routes";
import webSearchCallbackRoutes from "./routes/webSearchCallback.routes";

const fastify = Fastify({ logger: false, ignoreTrailingSlash: true });

const start = async () => {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const isProduction = process.env.NODE_ENV === "production" || process.env.ENV === "prod";
  const host = process.env.HOST || (isProduction || process.env.PORT ? "0.0.0.0" : "localhost");

  // Register logging plugin FIRST to ensure all requests are logged
  const logLevel = process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error" | undefined;
  await fastify.register(loggingPlugin, {
    logLevel: logLevel || "info",
    skipPaths: ["/api/v1/health", "/metrics", "/docs"],
    slowRequestThreshold: Number.parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS || "5000", 10),
  });

  // Register global error handler
  createErrorHandler(fastify);

  // Plugins
  await fastify.register(corsPlugin);
  await fastify.register(multipart, {
    attachFieldsToBody: false,
    limits: { fileSize: 50 * 1024 * 1024 },
  });
  await fastify.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
    routes: ["/api/v1/webhooks/ingestion", "/api/v1/web-search-callback", "/api/v1/toc-meta-callback"],
  });
  //   await fastify.register(multipartPlugin);
  // Swagger / OpenAPI
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: "Knowsis API",
        description: "A complete CRUD API with TypeBox schemas",
        version: "1.0.0",
      },
      servers: [{ url: "http://localhost:3000" }],
      tags: [
        {
          name: "Health",
          description: "Health check and system status endpoints",
        },
        {
          name: "Chat",
          description: "Chat sessions, streaming, and conversation management",
        },
        {
          name: "Files",
          description: "File upload, processing, and document management",
        },
        {
          name: "Web Search",
          description: "Web search tasks, agents, and external data retrieval",
        },
        {
          name: "Tasks",
          description: "Background task execution and management",
        },
        {
          name: "Callbacks",
          description: "Webhook endpoints for external service callbacks",
        },
        {
          name: "Admin",
          description: "Admin authentication and dashboard read APIs",
        },
      ],
    },
  });
  await fastify.register(swaggerUI, { routePrefix: "/docs" });
  //   await fastify.register(fastifyAuth);
  await fastify.register(authPlugin);
  await fastify.register(adminAuthPlugin);

  logger.debug("Authenticate plugin registered", { authenticate: !!fastify.authenticate });
  // Routes
  await fastify.register(healthRoutes, { prefix: "/api/v1/health" });
  await fastify.register(chatRoutes, { prefix: "/api/v1/chat-session" });
  await fastify.register(webSearchRoutes, {
    prefix: "/api/v1/agent/web-search",
  });
  await fastify.register(fileRoutes, { prefix: "/api/v1/files" });
  // Callbacks / webhooks and streamed chat
  await fastify.register(webSearchCallbackRoutes, {
    prefix: "/api/v1/web-search-callback",
  });
  await fastify.register(parsingCallbackRoutes, { prefix: "/api/v1" });
  await fastify.register(chatStreamRoutes, { prefix: "/api/v1/chat" });
  await fastify.register(finAgentRoutes, { prefix: "/api/v1/agent/fin" });
  await fastify.register(structuredReportRoutes, { prefix: "/api/v1/report" });
  await fastify.register(structuredReportCallbackRoutes, {
    prefix: "/api/structured-report-callback",
  });
  await fastify.register(tocMetaCallbackRoutes, {
    prefix: "/api/v1/toc-meta-callback",
  });
  await fastify.register(documentParseCallbackRoutes, {
    prefix: "/api/v1/document-parse-callback",
  });
  await fastify.register(analyticsRoutes, { prefix: "/api/v1/analytics" });
  await fastify.register(ingestionRoutes, { prefix: "/api/v1" });
  await fastify.register(adminAuthRoutes, { prefix: "/api/v1/admin/auth" });
  await fastify.register(adminRoutes, { prefix: "/api/v1/admin" });
  await fastify.register(adminPlaygroundRoutes, { prefix: "/api/v1/admin/playground" });

  // Start server
  const start = async () => {
    try {
      await fastify.listen({
        port,
        host,
      });
      logger.info("Server started successfully", {
        host,
        port,
        docsUrl: `http://${host}:${port}/docs`,
      });
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
  };

  await start();
};

start().catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
