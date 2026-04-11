/**
 * Place parsed media content back into page text.
 *
 * Handles two marker formats:
 *
 *   1. Mistral inline markers:
 *      - Tables:  [tbl-N.md](tbl-N.md)
 *      - Images:  ![img-N-N.jpeg](img-N-N.jpeg)
 *      These are replaced using the sourceId from DetectedMedia / ParsedMediaBlock.
 *      Tables without bounds get their Mistral `content` inlined directly.
 *      Images/tables with bounds get LLM-parsed content via sourceId matching.
 *
 *   2. Paddle fallback markers:
 *      [Insert table/media N here]
 *      Used for Paddle-detected media which has no Mistral marker in the text
 *      (since those regions were masked before Mistral OCR).
 */
import type { ParsedMediaBlock, PageResult, ParsedPage } from "../types.js";

/**
 * Inline Mistral table content into page markdown.
 * Replaces [tbl-N.md](tbl-N.md) markers with the actual table content
 * that Mistral extracted. Handles tables that don't have visual
 * bounding boxes and therefore skip the media pipeline.
 */
function inlineMistralTables(pages: PageResult[]): PageResult[] {
  return pages.map((page) => {
    let markdown = page.markdown;

    for (const table of page.tables) {
      if (!table.content || !table.id) continue;

      // Mistral uses markers like [tbl-1.md](tbl-1.md) or [tbl-1.md]
      const patterns = [
        `[${table.id}.md](${table.id}.md)`,
        `[${table.id}.md]`,
        `[${table.id}](${table.id})`,
      ];

      for (const pattern of patterns) {
        if (markdown.includes(pattern)) {
          markdown = markdown.replace(pattern, `\n\n${table.content}\n\n`);
          break;
        }
      }
    }

    return { ...page, markdown };
  });
}

/**
 * Build Mistral marker patterns for a given source ID.
 * Handles both image and table formats from Mistral OCR.
 */
function mistralMarkerPatterns(sourceId: string): string[] {
  return [
    // Image formats: ![img-0-0.jpeg](img-0-0.jpeg)
    `![${sourceId}.jpeg](${sourceId}.jpeg)`,
    `![${sourceId}.png](${sourceId}.png)`,
    `![${sourceId}](${sourceId})`,
    // Table formats: [tbl-0.md](tbl-0.md)
    `[${sourceId}.md](${sourceId}.md)`,
    `[${sourceId}.md]`,
    `[${sourceId}](${sourceId})`,
  ];
}

/**
 * Merge parsed media blocks into page content.
 *
 * For blocks with a sourceId (from Mistral), replaces the Mistral inline
 * marker. For blocks without (from Paddle), uses the fallback
 * "Insert table/media N here" marker or appends to page end.
 */
export function placeMediaBlocks(
  pages: PageResult[],
  parsedBlocks: ParsedMediaBlock[]
): ParsedPage[] {
  // Step 1: Inline Mistral table content (tables with content but no bounds)
  const pagesWithTables = inlineMistralTables(pages);

  // Step 2: Place LLM-parsed media blocks
  const placed = new Set<number>();
  const result: ParsedPage[] = [];

  for (const page of pagesWithTables) {
    let content = page.markdown;

    for (const block of parsedBlocks) {
      if (!block.parsedData || placed.has(block.idx)) continue;

      // Mistral sourceId markers — only match on the block's own page
      if (block.sourceId && block.page === page.pageIndex) {
        for (const pattern of mistralMarkerPatterns(block.sourceId)) {
          if (content.includes(pattern)) {
            content = content.replace(pattern, `\n\n${block.parsedData}\n\n`);
            placed.add(block.idx);
            break;
          }
        }
      }

      // Paddle markers — scan all pages since mask indices may not
      // match media block indices due to sort order differences
      if (!placed.has(block.idx)) {
        const fallbackPatterns = [
          `[${block.referenceIdx}]`,
          block.referenceIdx,
        ];
        for (const pattern of fallbackPatterns) {
          if (content.includes(pattern)) {
            content = content.replace(pattern, `\n\n${block.parsedData}\n\n`);
            placed.add(block.idx);
            break;
          }
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
    (b) => b.parsedData && !placed.has(b.idx)
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
