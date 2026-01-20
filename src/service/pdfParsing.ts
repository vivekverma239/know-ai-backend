import { StorageService } from "./storage";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { chunks, userFile, userFileToCMeta } from "../db/schema";
// import { env } from "@/env"; // Removed as unused
import { logger } from "../utils/logger";
import { parseToCMeta } from "@/agents/document/parseToCMeta";

const db = getDb();

export const parseToCMetaService = async (fileId: string): Promise<void> => {
    const file = await db.query.userFile.findFirst({
        where: eq(userFile.id, fileId),
    });
    if (!file) {
        throw new Error("File not found");
    }
    const storage = new StorageService();
    const path = `files/${file.userId}/${fileId}/${fileId}.pdf`;
    const pdfBuffer = await storage.downloadFile(path);
    const { result, tokenUsage } = await parseToCMeta(pdfBuffer);

    // Save to db
    await db
        .insert(userFileToCMeta)
        .values({
            fileId,
            toc: result.toc,
            metadata: result.metadata,
            pages: result.pages,
            tokenUsage: tokenUsage as any,
        })
        .onConflictDoUpdate({
            target: userFileToCMeta.fileId,
            set: {
                toc: result.toc,
                metadata: result.metadata,
                pages: result.pages,
                tokenUsage: tokenUsage as any,
            },
        });
};

export const parsePDF = async (fileId: string): Promise<void> => {
    // Redirecting to internal service instead of external API call for migration
    await parseToCMetaService(fileId);
};
