/**
 * DOCX parser. Converts a .docx file buffer to markdown pages by routing
 * through the HTML parser: mammoth extracts the DOCX structure as HTML
 * (preserving headings, lists, and tables with rowspan/colspan), and our
 * HTML parser then produces the same ParsedDocument shape as PDF/HTML
 * sources — including merged-cell markers in tables.
 */

import mammoth from "mammoth";
import { parseHtmlToMarkdown, type HtmlParserOptions, type ParsedHtmlDocument } from "./html-parser.js";

export type DocxParserOptions = HtmlParserOptions;

/** Parse a DOCX buffer into a ParsedDocument. */
export async function parseDocxToMarkdown(
  buffer: Buffer,
  options: DocxParserOptions = {},
): Promise<ParsedHtmlDocument> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return parseHtmlToMarkdown(html, options);
}
