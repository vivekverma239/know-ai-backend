import type { FastifyInstance } from "fastify";
import { User, CreateUser } from "../schemas/user.schema";
import { ErrorResponse } from "../schemas/error.schema";
import {
  getAllUsers,
  getUserById,
  createUser,
} from "../controllers/user.controller";

const userRoutes = async (fastify: FastifyInstance) => {
  fastify.get("/", {
    schema: {
      description: "Get all users",
      response: { 200: { type: "array", items: User } },
    },
    handler: getAllUsers,
  });

  fastify.get("/:id", {
    schema: {
      description: "Get user by ID",
      params: { type: "object", properties: { id: { type: "integer" } } },
      response: { 200: User, 404: ErrorResponse },
    },
    handler: getUserById,
  });

  fastify.post("/", {
    schema: {
      description: "Create a new user",
      body: CreateUser,
      response: { 201: User },
    },
    handler: createUser,
  });
};

export default userRoutes;
