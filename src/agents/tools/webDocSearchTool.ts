import { logger } from "@/utils/logger";
import { tool } from "ai";
import { z } from "zod";
import { webAgent } from "../webAgent";
import type { ToolContext } from "./toolContext";

/**
 * Searches the web for documents (PDFs + web articles) relevant to a query
 * and returns titles + URLs only.
 *
 * The agent is expected to feed those URLs into `bulkFileIndexingTool` which
 * delegates download + parse to parse-engine. This tool does NOT download
 * anything itself — that path is owned by parse-engine so we get one
 * stealth-bypass + format-detection pipeline instead of two.
 */
export const getWebDocSearchTool = ({ context }: { context: ToolContext }) => {
  return tool({
    description:
      "Agentic web search for documents (PDFs, articles, official filings). Returns titles + URLs only — pass them to bulkFileIndexingTool to download/parse/index.",
    inputSchema: z.object({
      query: z.string(),
    }),
    execute: async ({ query }: { query: string }) => {
      try {
        const result = await webAgent(query, context);
        const sources =
          result.sources?.map((source) => ({
            title: source.title,
            url: source.url,
            type: source.type, // "pdf" | "website"
            description: source.description,
          })) ?? [];
        return { sources };
      } catch (error) {
        logger.error(`Failed to search for documents for query ${query}`, {
          error: error instanceof Error ? error.message : "Unknown error",
        });
        return {
          error: "Failed to search for documents",
        };
      }
    },
  });
};
