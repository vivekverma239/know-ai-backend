import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./toolContext";
import { bullAddFiles, getFileStatuses } from "@/service/files";

export const getBulkFileIndexingTool = ({
    context,
}: {
    context: ToolContext;
}) => {
    return tool({
        description: "Index multiple documents in the knowledge base",
        inputSchema: z.object({
            pdfs: z.array(
                z
                    .object({
                        id: z.string(),
                        title: z.string(),
                        storagePath: z.string(),
                    })
                    .describe(
                        "This is the ID and storage path returned by web search agent",
                    ),
            ),
            webArticles: z.array(
                z
                    .object({
                        id: z.string(),
                        title: z.string(),
                        storagePath: z.string(),
                        url: z.string(),
                    })
                    .describe(
                        "This is the ID and storage path returned by web search agent",
                    ),
            ),
        }),
        execute: async ({
            pdfs,
            webArticles,
        }: {
            pdfs: { id: string; storagePath: string; title: string }[];
            webArticles: {
                id: string;
                storagePath: string;
                url: string;
                title: string;
            }[];
        }) => {
            try {
                await bullAddFiles({
                    pdfs,
                    webArticles,
                    userId: context.userId,
                    orgId: context.orgId, // Added support for orgId if available in context
                });
                return {
                    success: true,
                    message: "Files added to the knowledge base",
                };
            } catch (error) {
                console.error("Error adding files to the knowledge base", error);
                return {
                    success: false,
                    message: "Error adding files to the knowledge base",
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
