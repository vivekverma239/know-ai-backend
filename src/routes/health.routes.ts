import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

const healthRoutes = async (fastify: FastifyInstance) => {
  fastify.get("/", {
    schema: {
      description: "Health check route",
      tags: ["Health"],
      response: { 200: Type.Object({ status: Type.String() }) },
    },
    handler: async () => ({ status: "ok" }),
  });
};

export default healthRoutes;
