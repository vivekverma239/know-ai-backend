/**
 * URL fetching + HTML→markdown utilities exposed for in-process consumption.
 *
 * Kept on a separate subpath (`parse-engine/url-fetch`) so importing the main
 * `parse-engine` entry to use `parsePdfFromBuffer` doesn't pull in Playwright /
 * stealth-plugin / cheerio at module load.
 *
 * Use a dynamic `import("parse-engine/url-fetch")` from the consumer to defer
 * the heavy load until first use.
 */

export {
  downloadFromUrl,
  downloadHtmlFromUrl,
  downloadPdfFromUrl,
  closeBrowser,
  type DownloadOptions,
  type DownloadResult,
} from "./server/download.js";

export {
  parseHtmlToMarkdown,
  parseHtmlToMarkdownWithOutline,
  type ParsedHtmlPage,
  type ParsedHtmlDocument,
  type HtmlParserOptions,
} from "./html-parser.js";
