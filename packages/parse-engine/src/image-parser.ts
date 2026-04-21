/**
 * Image parser. Takes an image buffer (PNG/JPEG/WebP/GIF) and uses a vision
 * LLM (Claude Sonnet) to extract the content as markdown. Output shape is
 * the same single-page ParsedDocument contract used by the HTML and PDF
 * parsers — one page per image.
 *
 * Tables, charts, and diagrams are all converted to markdown tables via the
 * system prompt (not the shared cellsToMarkdownTable helper, since the LLM
 * handles grid inference directly from the image).
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

export interface ParsedImagePage {
  pageNumber: number;
  content: string;
}

export interface ParsedImageDocument {
  title: string;
  pages: ParsedImagePage[];
  totalPages: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface ImageParserOptions {
  /** Anthropic model id. Defaults to latest Sonnet. */
  model?: string;
  /** Override API key (falls back to ANTHROPIC_API_KEY env var). */
  apiKey?: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

const SUPPORTED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const SYSTEM_PROMPT = `You are a document parser that extracts content from images into markdown.

Your task:
1. Extract ALL visible text content from the image
2. Describe any visual elements (charts, diagrams, photos, illustrations)
3. Preserve document structure (headings, paragraphs, lists, tables)
4. Output clean, well-formatted markdown

CRITICAL TABLE HANDLING:
- ALL tables MUST be converted to markdown table syntax using pipes (|)
- Include a header row with the separator row below (| --- | --- |)
- Preserve all cell data exactly as shown
- For merged cells, annotate the origin cell with [rowspan=N] or [colspan=N]
  and leave the covered cells empty. Example:
    | Header A | Merged Header [colspan=2] |  |
    | --- | --- | --- |
    | a | b | c |

CRITICAL CHART/GRAPH HANDLING:
- Charts, graphs, and visual data representations MUST be converted to
  markdown tables of their underlying data
- Include axis labels as column headers
- Include data points as rows
- After the table, add a short paragraph summarizing the trend/insights
- Do NOT describe the chart visually — extract the data

TITLE EXTRACTION:
- Start the output with a single top-level heading (# Title) that
  represents the document or image's title, if one is visible
- If no obvious title, use the most prominent heading or skip the # line

Rules:
- Use # for the top-level title, ## for sections, ### for subsections
- Preserve bullet and numbered lists
- Convert ALL tables and charts to markdown tables (non-negotiable)
- Keep paragraphs separated by blank lines
- Do NOT add meta-commentary, explanations, or apologies
- Output ONLY the extracted markdown content`;

/** Strip a leading "# Title" line from markdown and return { title, rest }. */
function splitLeadingTitle(markdown: string): { title: string; rest: string } {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^# +([^\n]+)\n+([\s\S]*)$/);
  if (match) {
    return { title: match[1].trim(), rest: match[2].trim() };
  }
  return { title: "", rest: trimmed };
}

/**
 * Send an image to Claude vision and return the extracted markdown as a
 * single-page ParsedImageDocument.
 */
export async function parseImageToMarkdown(
  image: Buffer,
  mimeType: string,
  options: ImageParserOptions = {},
): Promise<ParsedImageDocument> {
  const mime = mimeType.toLowerCase();
  if (!SUPPORTED_MIMES.has(mime)) {
    throw new Error(
      `Unsupported image MIME type: ${mimeType}. Supported: PNG, JPEG, WebP, GIF.`,
    );
  }

  const modelId = options.model ?? DEFAULT_MODEL;
  const anthropic = createAnthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });

  const response = await generateText({
    model: anthropic(modelId),
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            image,
            mediaType: mime,
          },
          {
            type: "text",
            text: "Extract the content of this image as markdown, following the rules above.",
          },
        ],
      },
    ],
  });

  const { title, rest } = splitLeadingTitle(response.text);

  return {
    title,
    pages: [{ pageNumber: 1, content: rest || response.text.trim() }],
    totalPages: 1,
    usage: response.usage
      ? {
          inputTokens: response.usage.inputTokens ?? 0,
          outputTokens: response.usage.outputTokens ?? 0,
          totalTokens:
            response.usage.totalTokens ??
            (response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0),
        }
      : undefined,
  };
}

/**
 * Detect the image MIME type from the first few bytes (magic numbers).
 * Falls back to `null` if the bytes don't match any known image format.
 */
export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  const b = buffer;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: 47 49 46 38
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif";
  }
  // WebP: RIFF....WEBP
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
