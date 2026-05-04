/**
 * Verify parse-engine's url-fetch subpath works in-process.
 * Usage: node --env-file=.env scripts/test-parse-engine-fetch.mjs <url>
 */
const url = process.argv[2] ?? "https://example.com/";

console.log(`[test] importing parse-engine/url-fetch…`);
let mod;
try {
  mod = await import("parse-engine/url-fetch");
} catch (err) {
  console.error("[test] import failed:", err);
  process.exit(1);
}
console.log(`[test] imported. exports:`, Object.keys(mod));

const { downloadHtmlFromUrl, parseHtmlToMarkdown } = mod;

console.log(`[test] downloading ${url}…`);
const start = Date.now();
const result = await downloadHtmlFromUrl(url, { userAgent: "Mozilla/5.0 (compatible; KnowsisTest/1.0)" });
console.log(`[test] downloaded in ${Date.now() - start}ms`);
console.log(`[test] title=${result.title}`);
console.log(`[test] html.length=${result.html.length}`);
console.log(`[test] html sample (first 200): ${result.html.slice(0, 200)}`);

console.log(`[test] parseHtmlToMarkdown…`);
const parsed = parseHtmlToMarkdown(result.html, { title: result.title });
console.log(`[test] markdown pages=${parsed.pages.length}`);
const md = parsed.pages.map((p) => p.content).join("\n\n");
console.log(`[test] markdown.length=${md.length}`);
console.log(`[test] markdown sample (first 300): ${md.slice(0, 300)}`);

process.exit(0);
