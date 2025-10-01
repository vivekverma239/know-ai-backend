import dotenv from "dotenv";
dotenv.config();
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import fastifyAuth from "@fastify/auth";

import swaggerUI from "@fastify/swagger-ui";
import corsPlugin from "./plugins/cors.plugin";
// import multipartPlugin from "./plugins/multipart.plugin";
import authPlugin, { authFn } from "./plugins/auth.plugin";

import healthRoutes from "./routes/health.routes";
import chatRoutes from "./routes/chatSession.routes";
import webSearchRoutes from "./routes/webSearch.routes";
import fileRoutes from "./routes/file.routes";
import tasksRoutes from "./routes/tasks.routes";
import webSearchCallbackRoutes from "./routes/webSearchCallback.routes";
import parsingCallbackRoutes from "./routes/parsingCallback.routes";
import chatStreamRoutes from "./routes/chatStream.routes";

const fastify = Fastify({ logger: true });

const start = async () => {
  // Plugins
  await fastify.register(corsPlugin);
  await fastify.register(multipart, {
    attachFieldsToBody: false,
    limits: { fileSize: 50 * 1024 * 1024 },
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
      ],
    },
  });
  await fastify.register(swaggerUI, { routePrefix: "/docs" });
  //   await fastify.register(fastifyAuth);
  //   await fastify.register(authPlugin);
  fastify.decorate("authenticate", authFn);

  console.log("authenticate", fastify.authenticate);
  // Routes
  await fastify.register(healthRoutes, { prefix: "/api/v1/health" });
  await fastify.register(chatRoutes, { prefix: "/api/v1/chat-session" });
  await fastify.register(webSearchRoutes, {
    prefix: "/api/v1/agent/web-search",
  });
  await fastify.register(fileRoutes, { prefix: "/api/v1/files" });
  await fastify.register(tasksRoutes, { prefix: "/api/v1/tasks" });
  // Callbacks / webhooks and streamed chat
  await fastify.register(webSearchCallbackRoutes, {
    prefix: "/api/v1/web-search-callback",
  });
  await fastify.register(parsingCallbackRoutes, { prefix: "/api/v1" });
  await fastify.register(chatStreamRoutes, { prefix: "/api/v1/chat" });

  // Start server
  const start = async () => {
    try {
      await fastify.listen({ port: 3000 });
      console.log("✅ Server running at http://localhost:3000");
      console.log("📖 Docs at http://localhost:3000/docs");
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
