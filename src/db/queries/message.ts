import { type Message } from "@/@types/message";
import { type Message as SQLMessage } from "@/@types";

import { getDb } from "..";
import { messages, chatSession } from "../schema";
import { and, desc, eq, lt } from "drizzle-orm";
import type { ChatSession } from "@/@types";

/**
 * Create a new message in the database.
 * @param message - The message to create.
 * @returns The created message.
 */
export const createMessage = async (
  message: Message,
  chatSessionId: string
) => {
  const sqlMessage = {
    id: message.id,
    userId: message.userId,
    role: message.role,
    parts: message.parts,
    createdAt: message.createdAt,
    sessionId: chatSessionId,
  };
  const newMessage = await getDb()
    .insert(messages)
    .values(sqlMessage)
    .returning();
  return newMessage[0];
};

export const syncMessages = async (sqlMessages: SQLMessage[]) => {
  const newMessages = await getDb().transaction(async (tx) => {
    return await Promise.all(
      sqlMessages.map(async (message) => {
        return await tx
          .insert(messages)
          .values(message)
          .onConflictDoUpdate({
            target: [messages.id],
            set: {
              parts: message.parts,
              role: message.role,
              updatedAt: new Date(),
            },
          });
      })
    );
  });
  return newMessages;
};

/**
 * Get all messages for a session.
 * @param chatSessionId - The ID of the session.
 * @returns The messages for the session.
 */
export const getMessages = async (chatSessionId: string) => {
  const sessionMessages = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, chatSessionId));
  return sessionMessages
    .map((sessionMessage) => ({
      id: sessionMessage.id,
      role: sessionMessage.role,
      parts: sessionMessage.parts,
      metadata: sessionMessage.metadata,
      createdAt: sessionMessage.createdAt,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) as Message[];
};

export const getSessionWithMessages = async (
  sessionId: string,
  userId: string
) => {
  let session: ChatSession | undefined = await getDb()
    .select()
    .from(chatSession)
    .where(eq(chatSession.id, sessionId))
    .then((sessions) => sessions[0]);
  if (!session) {
    // Create a new session
    const newSession = await getDb()
      .insert(chatSession)
      .values({ id: sessionId, userId: userId, title: "New Session" })
      .returning();
    session = newSession[0];
  }
  const messages = await getMessages(sessionId);
  return {
    session,
    messages,
  };
};

/**
 * Create a new session in the database.
 * @param userId - The ID of the user.
 * @returns The created session.
 */
export const createSession = async (
  userId: string,
  id: string,
  title: string
) => {
  const newSession = await getDb()
    .insert(chatSession)
    .values({ id: id, userId: userId, title: title })
    .returning();
  return newSession[0];
};

/**
 * List all sessions for a user.
 * @param userId - The ID of the user.
 * @returns The sessions for the user.
 */
export const listSessions = async (
  userId: string,
  limit: number,
  cursor: string | undefined
) => {
  if (cursor) {
    // If we have a cursor, find the position of the cursor session
    const cursorSession = (
      await getDb()
        .select()
        .from(chatSession)
        .where(eq(chatSession.id, cursor))
        .limit(1)
    )[0];

    if (cursorSession) {
      const cursorSessionCreatedAt = cursorSession.createdAt;
      // Get sessions after the cursor
      return await getDb()
        .select()
        .from(chatSession)
        .where(
          and(
            eq(chatSession.userId, userId),
            lt(chatSession.createdAt, cursorSessionCreatedAt)
          )
        )
        .orderBy(desc(chatSession.createdAt))
        .limit(limit);
    }
  }

  // If no cursor or cursor not found, return first page
  return await getDb()
    .select()
    .from(chatSession)
    .where(eq(chatSession.userId, userId))
    .orderBy(desc(chatSession.createdAt))
    .limit(limit);
};

/**
 * Get the latest session ID for a user.
 * @param userId - The ID of the user.
 * @returns The latest session ID.
 */
export const getLatestSessionId = async (userId: string) => {
  const latestSession = await getDb()
    .select()
    .from(chatSession)
    .where(eq(chatSession.userId, userId))
    .orderBy(desc(chatSession.createdAt))
    .limit(1);
  if (latestSession.length !== 0 && latestSession[0]) {
    return latestSession[0].id;
  }
  return null;
};
