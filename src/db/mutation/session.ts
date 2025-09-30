import type { ChatSession } from "@/@types";
import { chatSession } from "../schema";
import { eq } from "drizzle-orm";
import { db } from "..";

export const updateSession = async (
  sessionId: string,
  data: Partial<ChatSession>
) => {
  await db.update(chatSession).set(data).where(eq(chatSession.id, sessionId));
};
