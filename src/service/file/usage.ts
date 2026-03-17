import type { TokenUsage } from "@/@types/tokenUsage";
import { getDb } from "@/db";
import { userFile } from "@/db/schema";
import { mergeTokenUsage } from "@/utils/tokenUsage";
import { eq } from "drizzle-orm";

export const updateUsage = async (fileId: string, usage: TokenUsage) => {
  await getDb().transaction(async (tx) => {
    const files = await tx
      .select({ tokenUsage: userFile.tokenUsage })
      .from(userFile)
      .where(eq(userFile.id, fileId))
      .for("update");
    const file = files[0];
    if (!file) return;
    const existingUsage = file.tokenUsage ?? {};
    const finalUsage = mergeTokenUsage(existingUsage, usage);
    await tx.update(userFile).set({ tokenUsage: finalUsage }).where(eq(userFile.id, fileId));
  });
};
