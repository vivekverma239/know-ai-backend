import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import corsPlugin from "./plugins/cors.plugin";
import multipartPlugin from "./plugins/multipart.plugin";
import authPlugin from "./plugins/auth.plugin";

import healthRoutes from "./routes/health.routes";
import userRoutes from "./routes/user.route";
import uploadRoutes from "./routes/upload.routes";
import chatRoutes from "./routes/chat.routes";
import webSearchRoutes from "./routes/webSearch.routes";
import fileRoutes from "./routes/file.routes";
import llmTipRoutes from "./routes/llmTip.routes";
import chatSessionRoutes from "./routes/chatSession.routes";
import tasksRoutes from "./routes/tasks.routes";

const fastify = Fastify({ logger: true });

const start = async () => {
  // Plugins
  await fastify.register(corsPlugin);
  await fastify.register(multipartPlugin);
  // Swagger / OpenAPI
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: "Fastify + TypeBox API",
        description: "A complete CRUD API with TypeBox schemas",
        version: "1.0.0",
      },
      servers: [{ url: "http://localhost:3000" }],
    },
  });
  await fastify.register(swaggerUI, { routePrefix: "/docs" });

  //   await fastify.register(swaggerPlugin);
  await fastify.register(authPlugin);

  // Routes
  await fastify.register(healthRoutes, { prefix: "/health" });
  await fastify.register(userRoutes, { prefix: "/users" });
  await fastify.register(uploadRoutes, { prefix: "/upload" });
  await fastify.register(chatRoutes, { prefix: "/chat" });
  await fastify.register(webSearchRoutes, { prefix: "/web-search" });
  await fastify.register(fileRoutes, { prefix: "/files" });
  await fastify.register(llmTipRoutes, { prefix: "/llm-tips" });
  await fastify.register(chatSessionRoutes, { prefix: "/chat-sessions" });
  await fastify.register(tasksRoutes, { prefix: "/tasks" });

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
