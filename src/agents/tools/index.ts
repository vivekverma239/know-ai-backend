// import { z } from "zod";
// import { tool, type ToolSet, generateText, type LanguageModelV1 } from "ai";
// import Exa from "exa-js";

// import { getPerplexityLLM } from "@/server/ai/llm";
// import { MODELS } from "@/@types/llm";
// import { logger } from "@/server/utils/logger";

// export const exaWebsiteContent = tool({
//   description:
//     "Fetches the page content for a given URL using Exa and returns a readable snippet.",
//   inputSchema: z.object({
//     url: z
//       .string()
//       .describe("Full URL to fetch, e.g. 'https://example.com/page'."),
//   }),
//   execute: async ({ url }) => {
//     const exa = new Exa(process.env.EXA_API_KEY as string);

//     const startTime = Date.now();
//     logger.debug(`Exa getting contents for ${url}`);
//     try {
//       const response = await exa.getContents(url);

//       const endTime = Date.now();
//       logger.debug(`Exa got contents for ${url} in ${endTime - startTime}ms`);

//       return response.results.map((result) => result.text).join("\n");
//     } catch (error) {
//       logger.error(`Exa error: ${(error as Error).message}`);
//       return `Exa error: ${(error as Error).message}`;
//     }
//   },
// });

// export const exaSearch = tool({
//   description:
//     "Searches the web using Exa and returns the most relevant information.",
//   inputSchema: z.object({
//     query: z.string().describe("The query to search the web for."),
//     queryType: z
//       .enum(["neural", "keyword"])
//       .describe("Google like 'keyword' search or 'neural' search."),
//     category: z
//       .enum(["news", "pdf"])
//       .describe("The category of the query to search the web for [Optional]")
//       .optional(),
//   }),
//   execute: async ({ query, queryType, category }) => {
//     const exa = new Exa(process.env.EXA_API_KEY as string);
//     const startTime = Date.now();
//     logger.debug(`Exa searching for ${query}`);
//     const response = await exa.search(query, {
//       type: queryType,
//       category: category,
//     });
//     const endTime = Date.now();
//     logger.debug(`Exa searched for ${query} in ${endTime - startTime}ms`);
//     return response.results.map((result) => {
//       return {
//         title: result.title,
//         url: result.url,
//         text: result.text,
//       };
//     });
//   },
// });

// // Perplexity search tool via AI SDK with optional domain restriction
// export const webSearchTool = tool({
//   description:
//     "Answers a query a by searching the web and finding the most relevant information.",
//   inputSchema: z.object({
//     query: z.string().describe("The user query to research."),
//     domain: z
//       .string()
//       .describe(
//         "Optional domain to prioritize or restrict sources, e.g. 'example.com', keep empty if you don't want to restrict the sources."
//       ),
//   }),
//   execute: async ({ query, domain }) => {
//     const startTime = Date.now();
//     logger.debug(`Perplexity searching for ${query}`);
//     try {
//       const model = getPerplexityLLM(MODELS.PERPLEXITY_SONAR);

//       const system = domain
//         ? `You are a research assistant. Provide a concise answer and include a final section titled 'Sources:' with a bullet list of canonical URLs used. Prefer sources from the domain ${domain} and, when possible, restrict sources to that domain.`
//         : `You are a research assistant. Provide a concise answer and include a final section titled 'Sources:' with a bullet list of canonical URLs used.`;

//       const userQuery = domain !== "" ? `site:${domain} ${query}` : query;

//       const response = await generateText({
//         model: model as unknown as LanguageModelV1,
//         messages: [
//           { role: "system", content: system },
//           { role: "user", content: userQuery },
//         ],
//         maxRetries: 2,
//       });

//       const endTime = Date.now();

//       logger.debug(`✅ Finished ${query} in ${endTime - startTime}ms `);

//       return {
//         text: response.text.trim(),
//         sources: response.sources,
//       };
//     } catch (error) {
//       logger.error(`Perplexity error: ${(error as Error).message}`);
//       return `Perplexity error: ${(error as Error).message}`;
//     }
//   },
// });
