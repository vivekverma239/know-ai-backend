import type { ChatSession } from "@/@types";
import { eq } from "drizzle-orm";
import { getDb } from "..";
import { chatSession } from "../schema";

export const updateSession = async (sessionId: string, data: Partial<ChatSession>) => {
  await getDb().update(chatSession).set(data).where(eq(chatSession.id, sessionId));
};
