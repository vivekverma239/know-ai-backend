import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateUserType } from "../schemas/user.schema";

export const getAllUsers = async () => [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
];

export const getUserById = async (
  request: FastifyRequest<{ Params: { id: number } }>,
  reply: FastifyReply
) => {
  const { id } = request.params;
  if (id === 1) {
    return { id: 1, name: "Alice", email: "alice@example.com" };
  }
  return reply.code(404).send({
    statusCode: 404,
    error: "Not Found",
    message: "User not found",
  });
};

export const createUser = async (
  request: FastifyRequest<{ Body: CreateUserType }>
) => {
  const { name, email } = request.body as CreateUserType;
  return { id: Date.now(), name, email };
};
