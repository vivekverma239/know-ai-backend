/**
 * LiteParse integration — fast local PDF text + structure extraction.
 * Used for chapter detection without image rendering.
 */
import { LiteParse } from "@llamaindex/liteparse";

export interface LiteParsePage {
  page: number;
  text: string;
  numItems: number;
  maxFontSize: number;
  fontSizes: number[];
  firstLine: string;
}

export interface LiteParseResult {
  pages: LiteParsePage[];
  totalPages: number;
}

/**
 * Parse a PDF with liteparse (no OCR) and extract structural signals per page.
 */
export async function parsePdfStructure(
  pdfPath: string,
  maxPages = 10000
): Promise<LiteParseResult> {
  const parser = new LiteParse({ ocrEnabled: false, maxPages });
  const raw = await parser.parse(pdfPath);

  const pages: LiteParsePage[] = raw.pages.map((p: any) => {
    const items = p.textItems ?? [];
    const sizes = items.map((t: any) => t.fontSize as number);
    const maxFont = sizes.length > 0 ? Math.max(...sizes) : 0;
    const lines = (p.text ?? "").trim().split("\n").filter((l: string) => l.trim());

    return {
      page: p.page,
      text: p.text ?? "",
      numItems: items.length,
      maxFontSize: Math.round(maxFont * 10) / 10,
      fontSizes: ([...new Set(sizes.map((s: number) => Math.round(s * 10) / 10))] as number[]).sort((a, b) => b - a),
      firstLine: lines[0]?.trim()?.slice(0, 150) ?? "",
    };
  });

  return { pages, totalPages: pages.length };
}

/**
 * Format pages for LLM with full page text + structural metadata.
 */
export function formatPagesForLLM(pages: LiteParsePage[]): string {
  return pages.map((p) => {
    const fontInfo = p.maxFontSize > 0 ? `${p.maxFontSize}pt` : "no-text";
    const meta = `[${p.numItems} items, maxFont=${fontInfo}, fonts=${p.fontSizes.slice(0, 5).join("/")}]`;
    return `--- Page ${p.page} ${meta} ---\n${p.text.trim()}`;
  }).join("\n\n");
}
