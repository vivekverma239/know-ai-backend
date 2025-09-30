import { handleFileUpload } from "../controllers/upload.controller";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

const uploadRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/", {
    preHandler: fastify.authenticate, // 🔐 protected
    schema: {
      consumes: ["multipart/form-data"],
      body: Type.Object({
        file: Type.Any(), // Swagger support
      }),
      response: {
        200: Type.Object({
          filename: Type.String(),
          size: Type.Number(),
        }),
      },
    },
    handler: handleFileUpload,
  });
};

export default uploadRoutes;
