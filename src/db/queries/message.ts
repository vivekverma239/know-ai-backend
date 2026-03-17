import type { Message as SQLMessage } from "@/@types";
import type { Message } from "@/@types/message";

import type { ChatSession } from "@/@types";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { getDb } from "..";
import { chatSession, messages } from "../schema";

/**
 * Create a new message in the database.
 * @param message - The message to create.
 * @returns The created message.
 */
export const createMessage = async (message: Message, chatSessionId: string) => {
  const sqlMessage = {
    id: message.id,
    userId: message.userId,
    role: message.role,
    parts: message.parts,
    createdAt: message.createdAt,
    sessionId: chatSessionId,
  };
  const newMessage = await getDb().insert(messages).values(sqlMessage).returning();
  return newMessage[0];
};

export const syncMessages = async (sqlMessages: SQLMessage[]) => {
  if (sqlMessages.length === 0) return [];
  return await getDb()
    .insert(messages)
    .values(sqlMessages)
    .onConflictDoUpdate({
      target: [messages.id],
      set: {
        parts: sql`excluded.parts`,
        role: sql`excluded.role`,
        updatedAt: new Date(),
      },
    });
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
    .where(eq(messages.sessionId, chatSessionId))
    .orderBy(asc(messages.createdAt));
  return sessionMessages.map((sessionMessage) => ({
    id: sessionMessage.id,
    role: sessionMessage.role,
    parts: sessionMessage.parts,
    metadata: sessionMessage.metadata,
    createdAt: sessionMessage.createdAt,
  })) as Message[];
};

export const getSessionWithMessages = async (sessionId: string, userId: string) => {
  // First check if session exists AND belongs to user
  let session: ChatSession | undefined = await getDb()
    .select()
    .from(chatSession)
    .where(
      and(
        eq(chatSession.id, sessionId),
        eq(chatSession.userId, userId), // Verify session belongs to user
      ),
    )
    .then((sessions) => sessions[0]);

  if (!session) {
    // Only create new session if user is requesting their own session
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
export const createSession = async (userId: string, title: string, id?: string) => {
  const values: { userId: string; title: string; id?: string } = { userId, title };
  if (id) values.id = id;
  const newSession = await getDb()
    .insert(chatSession)
    .values(values)
    .returning();
  return newSession[0];
};

/**
 * List all sessions for a user.
 * @param userId - The ID of the user.
 * @returns The sessions for the user.
 */
export const listSessions = async (userId: string, limit: number, cursor: string | undefined) => {
  if (cursor) {
    // If we have a cursor, find the position of the cursor session
    const cursorSession = (
      await getDb().select().from(chatSession).where(eq(chatSession.id, cursor)).limit(1)
    )[0];

    if (cursorSession) {
      const cursorSessionCreatedAt = cursorSession.createdAt;
      // Get sessions after the cursor
      return await getDb()
        .select()
        .from(chatSession)
        .where(
          and(eq(chatSession.userId, userId), lt(chatSession.createdAt, cursorSessionCreatedAt)),
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

/**
 * Get a session by ID.
 * @param sessionId - The ID of the session.
 * @returns The session.
 */
export const getSession = async (sessionId: string) => {
  const session = await getDb().select().from(chatSession).where(eq(chatSession.id, sessionId));
  return session[0];
};
