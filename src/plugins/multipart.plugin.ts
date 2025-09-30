import multipart from "@fastify/multipart";
import { type FastifyInstance } from "fastify";

const multipartPlugin = async (fastify: FastifyInstance) => {
  await fastify.register(multipart, {
    attachFieldsToBody: true, // access form fields + files in body
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  });
};

export default multipartPlugin;
