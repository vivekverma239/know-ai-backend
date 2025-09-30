import { Type } from "@sinclair/typebox";

export const ChatSessionSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  userId: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.Optional(Type.String()),
});

export const MessageSchema = Type.Object({
  id: Type.String(),
  role: Type.String(),
  sessionId: Type.String(),
  content: Type.String(),
  createdAt: Type.String(),
});

export const MessagesResponse = Type.Array(MessageSchema);

export const SessionWithMessagesResponse = Type.Object({
  session: ChatSessionSchema,
  messages: MessagesResponse,
});

export const ListSessionsResponse = Type.Object({
  sessions: Type.Array(ChatSessionSchema),
  nextCursor: Type.Optional(Type.String()),
});
