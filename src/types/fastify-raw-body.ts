import type { FastifyPluginCallback } from "fastify";

export interface RawBodyPluginOptions {
  field?: string;
  global?: boolean;
  encoding?: string | false;
  runFirst?: boolean;
  routes?: string[];
  jsonContentTypes?: string[];
}

declare const fastifyRawBody: FastifyPluginCallback<RawBodyPluginOptions>;

export default fastifyRawBody;

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string | Buffer;
  }
}
