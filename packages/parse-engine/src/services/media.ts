/**
 * Media block routing and parsing.
 * Routes TABLE blocks to Textract, FIGURE/IMAGE/CHART to vision LLM.
 */
import pLimit from "p-limit";
import { parseTableWithTextract } from "./textract.js";
import { parseChart, parseTableWithLLM } from "./chart.js";
import type { MediaBlock, ParsedMediaBlock } from "../types.js";
import type { PipelineContext } from "../context.js";

/**
 * Parse all media blocks concurrently with caching and retry.
 */
export async function parseMediaBlocks(
  blocks: MediaBlock[],
  ctx: PipelineContext,
  opts: {
    concurrency?: number;
    useTextract?: boolean;
  } = {}
): Promise<ParsedMediaBlock[]> {
  const { concurrency = 20, useTextract = true } = opts;
  const limit = pLimit(concurrency);

  console.log(`  Parsing ${blocks.length} media blocks (concurrency=${concurrency})...`);

  const tasks = blocks.map((block) =>
    limit(async (): Promise<ParsedMediaBlock> => {
      const blockCacheKey = block.cacheKey;
      let parsedData = "";

      try {
        if (block.type === "table") {
          if (useTextract) {
            // Textract has its own retry logic
            const cacheKey = ctx.key("textract", blockCacheKey);
            parsedData = await ctx.cached(cacheKey, () =>
              parseTableWithTextract(block.blockBytes)
            );
          } else {
            parsedData = await parseTableWithLLM(block.blockBytes, block.pageBytes, ctx, blockCacheKey);
          }
        } else {
          parsedData = await parseChart(block.blockBytes, block.pageBytes, ctx, blockCacheKey);
        }
      } catch (err) {
        console.error(`  Failed to parse block ${block.idx} (${block.type}):`, (err as Error).message);
      }

      return {
        referenceIdx: `Insert table/media ${block.idx} here`,
        parsedData,
        page: block.page,
        idx: block.idx,
        bounds: block.bounds,
      };
    })
  );

  const results = await Promise.all(tasks);

  const parsed = results.filter((r) => r.parsedData.length > 0);
  console.log(`  Parsed ${parsed.length}/${blocks.length} blocks successfully.`);

  return results;
}
