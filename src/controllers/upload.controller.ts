import type { FastifyReply, FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";

export const handleFileUpload = async (
  request: FastifyRequest<{ Body: { file?: MultipartFile } }>,
  reply: FastifyReply
) => {
  const { file } = request.body; // `attachFieldsToBody` gives file here
  if (!file) {
    return reply.code(400).send({ error: "No file uploaded" });
  }

  // Save file to disk (or S3, etc.)
  const buffer = await file.toBuffer();
  console.log("📂 File uploaded:", file.filename, buffer.length);

  return { filename: file.filename, size: buffer.length };
};
