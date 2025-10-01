import type { UIMessage, UIMessagePart, UITools } from "ai";

export enum Role {
  SYSTEM = "system",
  USER = "user",
  ASSISTANT = "assistant",
}

export type MessageParts = Array<
  UIMessagePart<Record<string, unknown>, UITools>
>;
export type Message = {
  id: string;
  userId: string;
  role: Role;
  parts: MessageParts;
  createdAt: Date;
  metadata?: Record<string, unknown>;
};

export type UserMessage = Message & {
  role: Role.USER;
};

export type AssistantMessage = Message & {
  role: Role.ASSISTANT;
};

export type SystemMessage = Message & {
  role: Role.SYSTEM;
};
