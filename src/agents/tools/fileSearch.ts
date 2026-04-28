import { similaritySearchDocuments } from "@/service/simSearch";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./toolContext";

export const getFileSearchTool = ({ context }: { context: ToolContext }) => {
  return tool({
    description:
      "Search the user's knowledge base and return up to 10 documents ranked by semantic similarity to the query. Does not support pagination — call again with a reworded query (synonyms, broader/narrower scope) if the results are insufficient.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "A natural-language search query. Use the user's question or a rewording of it; do not pass document IDs.",
        ),
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
