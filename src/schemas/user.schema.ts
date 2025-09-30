import { Type, type Static } from "@sinclair/typebox";

export const User = Type.Object({
  id: Type.Integer({ example: 1 }),
  name: Type.String({ example: "Alice" }),
  email: Type.String({ format: "email", example: "alice@example.com" }),
});
export type UserType = Static<typeof User>;

export const CreateUser = Type.Object({
  name: Type.String(),
  email: Type.String({ format: "email" }),
});
export type CreateUserType = Static<typeof CreateUser>;
