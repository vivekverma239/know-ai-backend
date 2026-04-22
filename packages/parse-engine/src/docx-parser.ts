/**
 * DOCX parser. Converts a .docx file buffer to markdown pages by routing
 * through the HTML parser: mammoth extracts the DOCX structure as HTML
 * (preserving headings, lists, and tables with rowspan/colspan), and our
 * HTML parser then produces the same ParsedDocument shape as PDF/HTML
 * sources — including merged-cell markers in tables and the same optional
 * outline/summary/metadata enrichment passes.
 */

import mammoth from "mammoth";
import {
  parseHtmlToMarkdown,
  parseHtmlToMarkdownWithOutline,
  type HtmlParserOptions,
  type ParsedHtmlDocument,
} from "./html-parser.js";
import { enrichDocument } from "./services/enrich.js";

export interface DocxParserOptions extends HtmlParserOptions {
  /**
   * Run the LLM-based document summary + metadata pass. Defaults to true
   * when the caller passes options explicitly. Shares page summaries with
   * the outline pass when `generateOutline` is also on.
   */
  generateEnrichment?: boolean;
}

/** Parse a DOCX buffer into a ParsedDocument. */
export async function parseDocxToMarkdown(
  buffer: Buffer,
  options: DocxParserOptions = {},
): Promise<ParsedHtmlDocument> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const { generateOutline = false, generateEnrichment = false, ...htmlOpts } = options;

  if (generateOutline) {
    return parseHtmlToMarkdownWithOutline(html, {
      ...htmlOpts,
      outlineOptions: {
        ...(htmlOpts.outlineOptions ?? {}),
        enrich: generateEnrichment,
      },
    });
  }

  const parsed = parseHtmlToMarkdown(html, htmlOpts);
  if (!generateEnrichment || parsed.pages.length === 0) return parsed;

  const enrichResult = await enrichDocument(parsed.pages, { title: parsed.title });
  return {
    ...parsed,
    summary: enrichResult.summary,
    metadata: enrichResult.metadata,
  };
}
