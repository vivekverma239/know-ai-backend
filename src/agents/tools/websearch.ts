import { z } from "zod";
import {
    tool,
    generateText,
    type UIMessageStreamWriter,
    type LanguageModelUsage,
} from "ai";
import Exa from "exa-js";
import FirecrawlApp from "@mendable/firecrawl-js";


import { getLLM } from "@/ai-backend/llm";
import { MODELS } from "@/@types/llm";
import { logger } from "@/utils/logger";
import { env } from "@/utils/env";
import type { ToolContext } from "./toolContext";

export const getWebsiteContentTool = ({
    context,
}: {
    context: ToolContext;
}) => {
    return tool({
        description:
            "Fetches the page content for a given URL using Exa and returns a readable snippet.",
        inputSchema: z.object({
            url: z
                .string()
                .describe("Full URL to fetch, e.g. 'https://example.com/page'."),
        }),
        execute: async ({ url }) => {
            const exa = new Exa(env.get("EXA_API_KEY"));

            const startTime = Date.now();
            logger.debug(`Exa getting contents for ${url}`);
            try {
                const response = await exa.getContents(url, {
                    livecrawl: "always",
                });

                const endTime = Date.now();
                logger.debug(`Exa got contents for ${url} in ${endTime - startTime}ms`);

                return response.results.map((result) => result.text).join("\n");
            } catch (error) {
                logger.error(`Exa error: ${(error as Error).message}`);
                return `Exa error: ${(error as Error).message}`;
            }
        },
    });
};

export const getFirecrawlScrapeTool = ({ context }: { context: ToolContext }) => {
    return tool({
        description:
            "Scrapes a URL using Firecrawl and returns clean markdown. Prefer this for complex, JS-heavy, or PDF pages.",
        inputSchema: z.object({
            url: z
                .string()
                .describe("Full URL to scrape, e.g. 'https://example.com/page'."),
        }),
        execute: async ({ url }) => {
            const firecrawl = new FirecrawlApp({
                apiKey: env.get("FIRECRAWL_API_KEY"),
            });

            const startTime = Date.now();
            logger.debug(`Firecrawl scraping ${url}`);

            try {
                const result = await firecrawl.scrape(url, {
                    formats: ["markdown"],
                });

                const endTime = Date.now();
                logger.debug(
                    `Firecrawl scraped ${url} in ${endTime - startTime}ms`,
                );

                return result;
            } catch (error) {
                logger.error(`Firecrawl error: ${(error as Error).message}`);
                return `Firecrawl error: ${(error as Error).message}`;
            }
        },
    });
};

export const getWebSearchTool = ({ context }: { context: ToolContext }) => {
    return tool({
        description:
            "Searches the web using Exa and returns the most relevant information.",
        inputSchema: z.object({
            query: z.string().describe("The query to search the web for."),
            queryType: z
                .enum(["neural", "keyword"])
                .describe("Google like 'keyword' search or 'neural' search.")
                .optional()
                .default("neural"),
            category: z
                .enum(["news", "pdf"])
                .describe("The category of the query to search the web for [Optional]")
                .optional(),
        }),
        execute: async ({ query, queryType = "neural", category }) => {
            const exa = new Exa(env.get("EXA_API_KEY"));
            const startTime = Date.now();
            logger.debug(`Exa searching for ${query}`);
            const response = await exa.search(query, {
                type: queryType,
                category: category,
            });
            const endTime = Date.now();
            logger.debug(`Exa searched for ${query} in ${endTime - startTime}ms`);
            return response.results.map((result) => {
                return {
                    title: result.title,
                    url: result.url,
                    text: result.text,
                };
            });
        },
    });
};

// Perplexity search tool via AI SDK with optional domain restriction
export const getPerplexitySearchTool = ({
    context,
}: {
    context: ToolContext;
}) => {
    return tool({
        description:
            "Answers a query a by searching the web and finding the most relevant information.",
        inputSchema: z.object({
            query: z.string().describe("The user query to research."),
            domain: z
                .string()
                .describe(
                    "Optional domain to prioritize or restrict sources, e.g. 'example.com', keep empty if you don't want to restrict the sources.",
                ),
        }),
        execute: async ({ query, domain }) => {
            const startTime = Date.now();
            logger.debug(`Perplexity searching for ${query}`);
            try {
                // Assuming helper exists or using generic LLM logic
                // Use a standard Perplexity model for search if helper missing in new env
                // The source used `getPerplexityLLM`, we can try `getLLM(MODELS.PERPLEXITY_SONAR)`
                const model = getLLM(MODELS.PERPLEXITY_SONAR);

                const system = domain
                    ? `You are a research assistant. Provide a concise answer and include a final section titled 'Sources:' with a bullet list of canonical URLs used. Prefer sources from the domain ${domain} and, when possible, restrict sources to that domain.`
                    : `You are a research assistant. Provide a concise answer and include a final section titled 'Sources:' with a bullet list of canonical URLs used.`;

                const userQuery = domain !== "" ? `site:${domain} ${query}` : query;

                const response = await generateText({
                    model: model,
                    messages: [
                        { role: "system", content: system },
                        { role: "user", content: userQuery },
                    ],
                    maxRetries: 2,
                });

                const endTime = Date.now();

                logger.debug(`✅ Finished ${query} in ${endTime - startTime}ms `);

                return {
                    text: response.text.trim(),
                    sources: (response).sources, // response.sources might be vendor specific, handled by wrapper? AI SDK generic response might not have it unless extended.
                    // For now returning text. If provider support sources in output or metadata, we should extract.
                };
            } catch (error) {
                logger.error(`Perplexity error: ${(error as Error).message}`);
                return `Perplexity error: ${(error as Error).message}`;
            }
        },
    });
};
