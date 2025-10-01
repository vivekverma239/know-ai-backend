import { userFile } from "@/db/schema";
import { type TokenUsage } from "@/@types/tokenUsage";
import { mergeTokenUsage } from "@/utils/tokenUsage";
import { getDb } from "@/db";
import { eq } from "drizzle-orm";

export const updateUsage = async (fileId: string, usage: TokenUsage) => {
  const file = await getDb().query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const existingUsage = file.tokenUsage;
  const finalUsage = mergeTokenUsage(existingUsage ?? {}, usage);
  await getDb()
    .update(userFile)
    .set({ tokenUsage: finalUsage })
    .where(eq(userFile.id, fileId));
};
