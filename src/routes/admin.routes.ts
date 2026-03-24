import type { FastifyInstance } from "fastify";
import { registerDocumentHandlers } from "./admin/documentHandlers";
import { registerEntityHandlers } from "./admin/entityHandlers";
import { registerOrgHandlers } from "./admin/orgHandlers";

const adminRoutes = async (fastify: FastifyInstance) => {
  await registerOrgHandlers(fastify);
  await registerDocumentHandlers(fastify);
  await registerEntityHandlers(fastify);
};

export default adminRoutes;
