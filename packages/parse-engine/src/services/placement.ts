/**
 * Place parsed media content back into page text.
 * Mirrors Python's place_chart_blocks() from src/parse.py
 *
 * For each parsed media block, finds its placeholder reference in the
 * Mistral OCR page content and replaces it with the actual parsed data.
 */
import type { ParsedMediaBlock, PageResult, ParsedPage } from "../types.js";

/**
 * Merge parsed media blocks into Mistral OCR page content.
 * Replaces "[Insert table/media N here]" placeholders with actual content.
 */
export function placeMediaBlocks(
  pages: PageResult[],
  parsedBlocks: ParsedMediaBlock[]
): ParsedPage[] {
  // Build reference → parsed data map
  const refMap = new Map<string, ParsedMediaBlock>();
  for (const block of parsedBlocks) {
    if (block.parsedData) {
      refMap.set(block.referenceIdx, block);
    }
  }

  // Track which refs were actually found and replaced
  const placed = new Set<string>();
  const result: ParsedPage[] = [];

  for (const page of pages) {
    let content = page.markdown;

    for (const [ref, block] of refMap) {
      // Match both exact placeholder and bracketed version
      const patterns = [`[${ref}]`, ref];

      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          content = content.replace(pattern, `\n\n${block.parsedData}\n\n`);
          placed.add(ref);
          break;
        }
      }
    }

    result.push({
      pageNumber: page.pageIndex,
      content,
    });
  }

  // Append unplaced blocks to their respective pages as fallback
  const unplaced = parsedBlocks.filter(
    (b) => b.parsedData && !placed.has(b.referenceIdx)
  );

  if (unplaced.length > 0) {
    for (const block of unplaced) {
      const page = result.find((p) => p.pageNumber === block.page);
      if (page) {
        page.content += `\n\n${block.parsedData}\n\n`;
      }
    }
    console.log(`  ${unplaced.length} blocks appended to page end (no placeholder found)`);
  }

  return result;
}
