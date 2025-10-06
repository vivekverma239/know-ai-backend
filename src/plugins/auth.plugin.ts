import {
  type FastifyRequest,
  type FastifyReply,
  type FastifyInstance,
} from "fastify";

// We'll use type assertion instead of extending FastifyRequest
// since Fastify's type system is complex and doesn't easily support custom request types

const authFn = async (request: FastifyRequest, reply: FastifyReply) => {
  console.log("Request URL", request.url);
  // Check for required headers
  const userId = request.headers["x-user-id"] as string;
  const orgId = request.headers["x-org-id"] as string;
  const authHeader = request.headers.authorization;

  // Validate required headers
  console.log("Request URL", request.url);
  if (!request.url.includes("callback")) {
    if (!userId) {
      return reply.code(400).send({
        error: "Missing required header: x-user-id",
      });
    }

    if (!orgId) {
      return reply.code(400).send({
        error: "Missing required header: x-org-id",
      });
    }
  }

  // Validate authorization header
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

  // TODO: Replace with actual JWT verification
  // For now, using simple token validation
  if (token !== process.env.BACKEND_TOKEN) {
    return reply.code(403).send({
      error: "Invalid token",
    });
  }

  // Populate request object with user information
  request.user = {
    id: userId,
    orgId: orgId,
    // Add other user fields as needed
    email: request.headers["x-user-email"] as string,
    name: request.headers["x-user-name"] as string,
  };
  console.log("Request user", request.user);
};

const authPlugin = async (fastify: FastifyInstance) => {
  console.log("Auth plugin");
  fastify.decorate("authenticate", authFn);
  console.log("Auth plugin decorated");
  console.log(fastify.authenticate);
};

export default authPlugin;

// TS augmentation
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => void;
  }

  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
export { authFn };

export interface AuthenticatedUser {
  id: string;
  email?: string;
  name?: string;
  orgId: string;
}
