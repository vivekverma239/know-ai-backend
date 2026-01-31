import { similaritySearchDocuments } from "@/service/simSearch";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./toolContext";

export const getFileSearchTool = ({ context }: { context: ToolContext }) => {
  return tool({
    description: "Search for documents based on the query",
    inputSchema: z.object({
      query: z.string().describe("The query to search for"),
    }),
    execute: async ({ query }: { query: string }) => {
      // Assuming similaritySearchDocuments exists in @/service/simSearch
      return await similaritySearchDocuments({
        query,
        limit: 10,
        userId: context.userId,
        orgId: context.orgId,
      });
    },
  });
};
