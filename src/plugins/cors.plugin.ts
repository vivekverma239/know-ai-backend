import cors from "@fastify/cors";
import { type FastifyInstance } from "fastify";

const corsPlugin = async (fastify: FastifyInstance) => {
  await fastify.register(cors, {
    origin: "*", // or restrict to specific domains
    methods: ["GET", "POST", "PUT", "DELETE"],
  });
};

export default corsPlugin;
