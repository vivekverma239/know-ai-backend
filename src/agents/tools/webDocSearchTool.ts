import { downloadPDFTask, urlToMarkdownTask } from "@/service/trigger-tasks";
import { logger } from "@/utils/logger";
import { tool } from "ai";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { webAgent } from "../webAgent";
import type { ToolContext } from "./toolContext";

export const getWebDocSearchTool = ({ context }: { context: ToolContext }) => {
  return tool({
    description:
      "Agentic search to search relevant PDFs a links from web, using this to do comprehensive search for documents like annunal reports etc",
    inputSchema: z.object({
      query: z.string(),
    }),
    execute: async ({ query }: { query: string }) => {
      try {
        const result = await webAgent(query, context);

        // Process PDFs and markdowns from sources
        const pdfUrls: string[] = [];
        const websiteUrls: string[] = [];
        const sourceTitles: Record<string, string> = {};

        if (result.sources) {
          for (const source of result.sources) {
            sourceTitles[source.url] = source.title;
            if (source.type === "pdf") {
              pdfUrls.push(source.url);
            } else if (source.type === "website") {
              websiteUrls.push(source.url);
            }
          }
        }
        const [pdfs, markdowns] = await Promise.all([
          downloadPDFTask({
            pdfSources: pdfUrls.map((url) => ({
              url,
              fileId: uuidv4(),
            })),
          }),
          urlToMarkdownTask({
            urls: websiteUrls,
          }),
        ]);

        // Return Sources with PDF and Markdown URLs
        const validSources =
          result.sources
            .map((source) => {
              if (source.type === "pdf") {
                const pdf = pdfs.find((pdf) => pdf.url === source.url);
                if (pdf) {
                  return {
                    ...source,
                    id: pdf.id,
                    storagePath: pdf.storagePath,
                  };
                }
              } else if (source.type === "website") {
                const markdown = markdowns.find((markdown) => markdown.url === source.url);
                if (markdown) {
                  return {
                    ...source,
                    id: uuidv4(),
                    storagePath: markdown.storagePath,
                  };
                }
              }
              return null;
            })
            .filter((source): source is NonNullable<typeof source> => !!source) ?? [];

        return { sources: validSources };
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
