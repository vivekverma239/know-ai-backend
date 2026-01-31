import { eq } from "drizzle-orm";
import type { Source } from "../db/schema";
import { userFile } from "../db/schema";
import type { UserFile } from "@/@types";
import { getDb } from "@/db";

export const parseSources = async (text: string) => {
  // Collate sources
  const finalReportSources = text.match(/(\[file_[\w-]+)\/page=(\d+)/g);

  const fileIdLookup = new Map<string, UserFile>();
  const sources = (await Promise.all(
    finalReportSources
      ? finalReportSources.map(async (source) => {
        const [id, pageNumbers] = source.split("/page=");

        const fileId = id!.replace("[file_", "").replace("]", "");
        let file = fileIdLookup.get(fileId);
        if (!file) {
          file = await getDb().query.userFile.findFirst({
            where: eq(userFile.id, fileId),
          });
          if (!file) {
            return null;
          }
          fileIdLookup.set(fileId, file);
          return {
            id: fileId,
            url: `file/${id}?page=${pageNumbers?.split(",").join(",")}`,
            title: file.name,
            summary: file.metadata?.shortSummary,
            pageNumbers: pageNumbers?.split(",").map(Number) ?? [],
          } as Source;
        }

        // For now we wont save duplicate sources
        return null;
      })
      : [],
  )) as Source[];

  return sources.filter((source) => source !== null);
};
