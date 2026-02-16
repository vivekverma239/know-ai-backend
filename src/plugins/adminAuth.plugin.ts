import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { jwtVerify } from "jose";

export interface AuthenticatedAdmin {
  userId: string;
  expiresAt: string;
}

const getJwtSecret = () => {
  const jwtSecret = process.env.ADMIN_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("ADMIN_JWT_SECRET is required for admin auth.");
  }
  return new TextEncoder().encode(jwtSecret);
};

const authenticateAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.code(401).send({
      error: "Missing or invalid authorization header",
    });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return reply.code(401).send({
      error: "Missing bearer token",
    });
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.tokenType !== "admin_access") {
      return reply.code(401).send({
        error: "Invalid admin access token",
      });
    }

    const userId = typeof payload.userId === "string" ? payload.userId : null;
    const exp = typeof payload.exp === "number" ? payload.exp : null;
    if (!userId || !exp) {
      return reply.code(401).send({
        error: "Invalid admin access token payload",
      });
    }

    request.admin = {
      userId,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  } catch {
    return reply.code(401).send({
      error: "Invalid or expired admin access token",
    });
  }
};

const adminAuthPlugin = async (fastify: FastifyInstance) => {
  fastify.decorate("authenticateAdmin", authenticateAdmin);
};

export default fp(adminAuthPlugin, {
  name: "admin-auth-plugin",
  fastify: "5.x",
});

declare module "fastify" {
  interface FastifyInstance {
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    admin?: AuthenticatedAdmin;
  }
}
