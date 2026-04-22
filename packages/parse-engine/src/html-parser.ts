/**
 * HTML parser. Takes raw HTML and produces a markdown document with the same
 * shape as the PDF pipeline (pages[], title, metadata). Tables are converted
 * to markdown using the shared cellsToMarkdownTable helper so the output is
 * consistent across all parser sources.
 *
 * Pipeline:
 *   1. Strip noise (scripts, styles, nav, ads).
 *   2. Extract title from <title>, og:title, or the first <h1>.
 *   3. Locate the main content element (<main>, <article>, else <body>).
 *   4. Walk every <table>, convert to markdown via cellsToMarkdownTable,
 *      replace the element with a unique placeholder.
 *   5. Convert the remaining HTML to markdown via turndown.
 *   6. Substitute table placeholders with their rendered markdown.
 *   7. Paginate: by <h1> boundaries if present, else by <h2>, else by char
 *      length (default 8000 chars per page), else a single page.
 */

import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { generateHtmlOutline, type HtmlOutlineOptions } from "./html-outline.js";
import { cellsToMarkdownTable, type TableCell } from "./services/table-to-markdown.js";
import type { ChapterWithSections } from "./services/outline.js";
import type { Section, DocumentSummary, DocumentMetadata } from "./types.js";

export interface ParsedHtmlPage {
  pageNumber: number;
  content: string;
}

export interface ParsedHtmlDocument {
  title: string;
  pages: ParsedHtmlPage[];
  totalPages: number;
  /** LLM-generated chapter tree. Present when generateOutline=true. */
  chapters?: ChapterWithSections[];
  /** Flat list of all sections across chapters. Present when generateOutline=true. */
  outline?: Section[];
  /** LLM-generated document summary. Present when generateOutline=true (and enrich isn't disabled). */
  summary?: DocumentSummary;
  /** LLM-generated document metadata. Present when generateOutline=true (and enrich isn't disabled). */
  metadata?: DocumentMetadata;
}

export interface HtmlParserOptions {
  /** Max characters per page when falling back to length-based pagination. */
  maxCharsPerPage?: number;
  /**
   * When true, runs the LLM-based page-summary + chapter-detection pipeline
   * (same as PDFs) to populate `chapters` and `outline` on the result.
   * Adds one LLM call per batch of 20 pages plus one per chapter. Opt-in
   * because it costs tokens and adds seconds to the parse.
   */
  generateOutline?: boolean;
  /** Forwarded to generateHtmlOutline when generateOutline=true. */
  outlineOptions?: HtmlOutlineOptions;
}

const DEFAULT_MAX_CHARS_PER_PAGE = 8000;

// Placeholder using only word characters so turndown doesn't escape them
// (turndown escapes `_`, `*`, etc. which would break the regex substitution).
const TABLE_TOKEN = (i: number) => `XPARSETABLEX${i}XENDX`;
const TABLE_TOKEN_RE = /XPARSETABLEX(\d+)XENDX/g;

/**
 * Convert a cheerio <table> into a TableCell[] that respects rowspan /
 * colspan. Tracks occupied cells so later <tr>s shift right correctly when a
 * cell from an earlier row spans into them.
 */
function htmlTableToCells(
  $table: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
): TableCell[] {
  const cells: TableCell[] = [];
  const occupied = new Set<string>();
  const keyOf = (r: number, c: number) => `${r}-${c}`;

  let rowIdx = 1;
  $table.find("tr").each((_, tr) => {
    let colIdx = 1;
    $(tr)
      .children("th, td")
      .each((__, td) => {
        // Advance past columns already occupied by earlier rowspans
        while (occupied.has(keyOf(rowIdx, colIdx))) colIdx++;

        const $cell = $(td);
        const rowSpan = Math.max(1, parseInt($cell.attr("rowspan") ?? "1", 10) || 1);
        const colSpan = Math.max(1, parseInt($cell.attr("colspan") ?? "1", 10) || 1);
        const text = $cell.text().replace(/\s+/g, " ").trim();

        cells.push({ row: rowIdx, col: colIdx, rowSpan, colSpan, text });

        for (let r = rowIdx; r < rowIdx + rowSpan; r++) {
          for (let c = colIdx; c < colIdx + colSpan; c++) {
            if (r !== rowIdx || c !== colIdx) occupied.add(keyOf(r, c));
          }
        }

        colIdx += colSpan;
      });
    rowIdx++;
  });

  return cells;
}

/** Build a turndown instance tuned for article content. */
function createTurndown(): TurndownService {
  return new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
  });
}

/**
 * Clean the DOM in-place: remove scripts, styles, nav/footer/aside, inline
 * event handlers, and link-rel=stylesheet.
 */
function stripNoise($: cheerio.CheerioAPI): void {
  $(
    "script, style, noscript, link[rel='stylesheet'], template, " +
      "nav, footer, aside, " +
      "iframe[src*='googletagmanager'], iframe[src*='doubleclick']",
  ).remove();
  $("[onclick], [onload], [onerror]")
    .removeAttr("onclick")
    .removeAttr("onload")
    .removeAttr("onerror");
}

function extractTitle($: cheerio.CheerioAPI): string {
  return (
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    ""
  );
}

/** Paginate by <h1> boundaries, falling back to <h2>, then length. */
function paginate(markdown: string, maxChars: number): string[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [];

  // Count top-level markdown headings (# and ##) that start on a new line
  const h1Count = (trimmed.match(/^# [^\n]+$/gm) ?? []).length;
  const h2Count = (trimmed.match(/^## [^\n]+$/gm) ?? []).length;

  const splitOn = (re: RegExp): string[] => {
    // Split while keeping the delimiter at the start of each chunk
    const parts: string[] = [];
    const matches = [...trimmed.matchAll(re)];
    if (matches.length === 0) return [trimmed];

    let cursor = 0;
    const preface = trimmed.slice(0, matches[0].index ?? 0).trim();
    if (preface) parts.push(preface);

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index ?? 0;
      const end = i + 1 < matches.length ? matches[i + 1].index ?? trimmed.length : trimmed.length;
      parts.push(trimmed.slice(start, end).trim());
      cursor = end;
    }
    return parts.filter(Boolean);
  };

  if (h1Count >= 2) return splitOn(/^# [^\n]+$/gm);
  if (h2Count >= 2) return splitOn(/^## [^\n]+$/gm);

  // Length-based fallback: split on paragraph breaks, accumulate to maxChars
  if (trimmed.length <= maxChars) return [trimmed];

  const paragraphs = trimmed.split(/\n{2,}/);
  const pages: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      pages.push(current.trim());
      current = "";
    }
    current += (current ? "\n\n" : "") + para;
  }
  if (current.trim()) pages.push(current.trim());
  return pages;
}

/**
 * Synchronous markdown-only entry point. Does not generate chapters/outline —
 * use parseHtmlToMarkdownWithOutline for that (it's async because LLM calls).
 */
export function parseHtmlToMarkdown(
  html: string,
  options: HtmlParserOptions = {},
): ParsedHtmlDocument {
  const maxChars = options.maxCharsPerPage ?? DEFAULT_MAX_CHARS_PER_PAGE;

  const $ = cheerio.load(html);
  const title = extractTitle($);
  stripNoise($);

  // Pick the "main" content element: <main>, <article>, or <body>.
  // Cast via `any` because cheerio v1's root() returns Cheerio<Document>,
  // which isn't assignable to Cheerio<AnyNode> without an assertion.
  let $root: cheerio.Cheerio<any> = $("main").first();
  if ($root.length === 0) $root = $("article").first();
  if ($root.length === 0) $root = $("body").first();
  if ($root.length === 0) $root = $.root() as unknown as cheerio.Cheerio<any>;

  // Extract tables first so turndown doesn't have to handle them
  const tableMarkdowns: string[] = [];
  $root.find("table").each((_, el) => {
    const cells = htmlTableToCells($(el), $);
    const md = cellsToMarkdownTable(cells);
    const idx = tableMarkdowns.length;
    tableMarkdowns.push(md);
    // Replace with a paragraph-level placeholder so turndown treats it as text
    $(el).replaceWith(`<p>${TABLE_TOKEN(idx)}</p>`);
  });

  // Convert to markdown
  const turndown = createTurndown();
  const rawMarkdown = turndown.turndown($root.html() ?? "");

  // Restore tables
  const finalMarkdown = rawMarkdown
    .replace(TABLE_TOKEN_RE, (_, idx) => `\n\n${tableMarkdowns[Number(idx)] ?? ""}\n\n`)
    // Collapse excessive blank lines introduced by turndown + substitution
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const pageContents = paginate(finalMarkdown, maxChars);
  const pages: ParsedHtmlPage[] = pageContents.map((content, i) => ({
    pageNumber: i + 1,
    content,
  }));

  return {
    title,
    pages,
    totalPages: pages.length,
  };
}

/**
 * Async entry point that runs the markdown parser and then the LLM-based
 * chapter/outline generator. Produces the same `chapters` and `outline`
 * fields as the PDF pipeline — useful for long HTML documents (SEC filings,
 * research papers) where navigation structure is valuable.
 */
export async function parseHtmlToMarkdownWithOutline(
  html: string,
  options: Omit<HtmlParserOptions, "generateOutline"> = {},
): Promise<ParsedHtmlDocument> {
  const doc = parseHtmlToMarkdown(html, options);
  if (doc.pages.length === 0) return doc;

  const { chapters, outline, summary, metadata } = await generateHtmlOutline(
    doc.pages,
    doc.title,
    options.outlineOptions,
  );

  return { ...doc, chapters, outline, summary, metadata };
}
