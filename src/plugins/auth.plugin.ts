import {
  type FastifyRequest,
  type FastifyReply,
  type FastifyInstance,
} from "fastify";

const authPlugin = async (fastify: FastifyInstance) => {
  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const token = authHeader?.split(" ")[1];
      if (token !== "mysecrettoken") {
        return reply.code(403).send({ error: "Forbidden" });
      }
    }
  );
};

export default authPlugin;

// TS augmentation
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => void;
  }
}
