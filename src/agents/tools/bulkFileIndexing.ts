import { bulkAddFiles, getFileStatuses } from "@/service/files";
import { logger } from "@/utils/logger";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./toolContext";

/**
 * Index a batch of documents into the user's knowledge base by URL.
 *
 * The agent passes titles + URLs returned by `webDocSearchTool`. The service
 * layer (`bulkAddFiles`) inserts userFile rows and delegates fetch/parse to
 * parse-engine — for PDFs via the existing async parse pipeline, for web
 * articles via parse-engine's URL fetch + HTML→markdown utilities.
 *
 * Returns the inserted file IDs so the agent can poll status via
 * `fileStatusTool`.
 */
export const getBulkFileIndexingTool = ({
  context,
}: {
  context: ToolContext;
}) => {
  return tool({
    description:
      "Add documents to the knowledge base by URL. Pass titles + URLs from webDocSearchTool. Returns the inserted file IDs.",
    inputSchema: z.object({
      pdfs: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
          }),
        )
        .describe("PDFs returned by webDocSearchTool (type === 'pdf')."),
      webArticles: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
          }),
        )
        .describe("Web articles returned by webDocSearchTool (type === 'website')."),
    }),
    execute: async ({
      pdfs,
      webArticles,
    }: {
      pdfs: { url: string; title: string }[];
      webArticles: { url: string; title: string }[];
    }) => {
      try {
        const result = await bulkAddFiles({
          pdfs,
          webArticles,
          userId: context.userId,
          orgId: context.orgId,
        });
        return {
          success: true,
          message: "Files added to the knowledge base",
          ...result,
        };
      } catch (error) {
        logger.error("Error adding files to the knowledge base", {
          error: error instanceof Error ? error.message : String(error),
          pdfs: pdfs.length,
          webArticles: webArticles.length,
        });
        return {
          success: false,
          message: `Error adding files to the knowledge base: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  });
};

export const getFileStatusTool = ({ context }: { context: ToolContext }) => {
  return tool({
    description: "Get the status of the files",
    inputSchema: z.object({
      fileIds: z.array(z.string()),
    }),
    execute: async ({ fileIds }: { fileIds: string[] }) => {
      return await getFileStatuses(fileIds, context.userId);
    },
  });
};
