import { Type } from "@sinclair/typebox";

export const LlmTipSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  content: Type.String(),
  category: Type.Optional(Type.String()),
  createdById: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.Optional(Type.String()),
});

export const LlmTipCreateBody = Type.Object({
  title: Type.String(),
  content: Type.String(),
  category: Type.Optional(Type.String()),
  userId: Type.String(),
  orgId: Type.String(),
});

export const LlmTipUpdateBody = Type.Partial(
  Type.Object({
    title: Type.String(),
    content: Type.String(),
    category: Type.String(),
    userId: Type.String(),
    orgId: Type.String(),
  })
);

export const SuccessResponse = Type.Object({ success: Type.Boolean() });
