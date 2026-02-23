import { getEmbeddings } from "@/ai-backend/embeddings";
import {
  getCalendarContext,
  getHighlightsContext,
  getScenariosContext,
  getTrendsContext,
  searchExternalEntities,
  searchExternalTags,
  semanticSearchExternalEntities,
  type ExternalContextFilters,
} from "@/service/externalContext";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./toolContext";

const EMBEDDING_KEYS = new Set([
  "contentEmbedding",
  "descriptionEmbedding",
  "embedding",
]);

/** Recursively strip embedding / large binary fields from objects before returning to the LLM. */
const stripEmbeddings = <T>(obj: T): T => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripEmbeddings) as T;
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (EMBEDDING_KEYS.has(key)) continue;
      out[key] = stripEmbeddings(value);
    }
    return out as T;
  }
  return obj;
};

const MAX_TOOL_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const clampToolLimit = (limit?: number) =>
  Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_TOOL_LIMIT);

export const getTeamContextTool = ({ context }: { context: ToolContext }) => {
  return tool({
    description:
      "Access your team's research data — highlights, trends, scenarios, calendar events, entities, and tags. " +
      "Use this to find team-generated insights, market views, entity trends, and scheduled events. " +
      "Data is automatically filtered to the user's teams.",
    inputSchema: z.object({
      category: z
        .enum([
          "highlights",
          "trends",
          "scenarios",
          "calendar",
          "entities",
          "search_entities",
          "semantic_search_entities",
          "search_tags",
        ])
        .describe(
          "The type of team data to query. " +
            '"highlights" = research highlights, "trends" = entity/market trends, ' +
            '"scenarios" = scenario analyses, "calendar" = calendar events, ' +
            '"entities"/"search_entities" = search entities by name (keyword match), ' +
            '"semantic_search_entities" = find entities by meaning using semantic/vector similarity (best for natural language queries), ' +
            '"search_tags" = search tags by name.',
        ),
      query: z
        .string()
        .optional()
        .describe(
          "Search query string. Required for search_entities, semantic_search_entities, and search_tags categories.",
        ),
      from: z
        .string()
        .optional()
        .describe("ISO date string to filter results from (inclusive)."),
      to: z
        .string()
        .optional()
        .describe("ISO date string to filter results until (inclusive)."),
      limit: z
        .number()
        .optional()
        .describe(`Number of results to return (default ${DEFAULT_LIMIT}, max ${MAX_TOOL_LIMIT}).`),
    }),
    execute: async ({ category, query, from, to, limit }) => {
      const effectiveLimit = clampToolLimit(limit);

      const filters: ExternalContextFilters = {
        teamIds: context.teamIds,
        from,
        to,
        limit: effectiveLimit,
      };

      switch (category) {
        case "highlights": {
          const result = await getHighlightsContext(filters);
          return stripEmbeddings(result);
        }
        case "trends": {
          const result = await getTrendsContext(filters);
          return stripEmbeddings(result);
        }
        case "scenarios": {
          const result = await getScenariosContext(filters);
          return stripEmbeddings(result);
        }
        case "calendar": {
          const result = await getCalendarContext(filters);
          return stripEmbeddings(result);
        }
        case "entities":
        case "search_entities": {
          if (!query) return { error: "query is required for search_entities" };
          const result = await searchExternalEntities({ query, limit: effectiveLimit });
          return stripEmbeddings(result);
        }
        case "semantic_search_entities": {
          if (!query) return { error: "query is required for semantic_search_entities" };
          const [embedding] = await getEmbeddings([query]);
          const result = await semanticSearchExternalEntities({
            embedding,
            limit: effectiveLimit,
          });
          return stripEmbeddings(result);
        }
        case "search_tags": {
          if (!query) return { error: "query is required for search_tags" };
          const result = await searchExternalTags({
            query,
            teamIds: context.teamIds,
            limit: effectiveLimit,
          });
          return stripEmbeddings(result);
        }
        default:
          return { error: `Unknown category: ${category}` };
      }
    },
  });
};
