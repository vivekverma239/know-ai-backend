import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import corsPlugin from "./plugins/cors.plugin";
import multipartPlugin from "./plugins/multipart.plugin";
import authPlugin from "./plugins/auth.plugin";

import healthRoutes from "./routes/health.routes";
import userRoutes from "./routes/user.route";
import uploadRoutes from "./routes/upload.routes";

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
