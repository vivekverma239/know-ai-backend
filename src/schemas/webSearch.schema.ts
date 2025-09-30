import { Type } from "@sinclair/typebox";

export const WebSearchSource = Type.Object({
  url: Type.String(),
  title: Type.String(),
  type: Type.Union([Type.Literal("pdf"), Type.Literal("website")]),
  description: Type.String(),
});

export const WebSearchTaskSchema = Type.Object({
  id: Type.String(),
  userId: Type.String(),
  query: Type.String(),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("failed"),
  ]),
  sources: Type.Optional(Type.Array(WebSearchSource)),
  helpfulText: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  completedAt: Type.Optional(Type.String()),
});

export const AgentResultSchema = Type.Object(
  {},
  { additionalProperties: true }
);
