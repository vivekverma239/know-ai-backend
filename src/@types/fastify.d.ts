import "fastify";

export interface AuthenticatedUser {
  id: string;
  email?: string;
  name?: string;
  orgId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
