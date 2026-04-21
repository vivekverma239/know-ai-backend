import * as cheerio from "cheerio";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext } from "playwright";
import fs from "node:fs";
import UserAgent from "user-agents";

chromium.use(StealthPlugin());

// Fallback when the UA generator fails (e.g. no matching device/platform)
const FALLBACK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// SEC.gov requires an identifying User-Agent with contact info per their fair
// access policy (https://www.sec.gov/developer). Override via SEC_USER_AGENT.
const SEC_USER_AGENT = process.env.SEC_USER_AGENT ?? "Knowsis AI contact@knowsis.ai";

const SEC_HOSTS = /(^|\.)sec\.gov$/i;

/**
 * Pick a User-Agent based on the target URL:
 *   - SEC.gov domains → identifying UA (required by their policy)
 *   - Everything else → rotating realistic desktop Chrome UA via user-agents
 */
function pickUserAgent(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (SEC_HOSTS.test(host)) return SEC_USER_AGENT;
  } catch {
    // Bad URL — fall through to default
  }

  try {
    const ua = new UserAgent({ deviceCategory: "desktop" }).toString();
    return ua || FALLBACK_USER_AGENT;
  } catch {
    return FALLBACK_USER_AGENT;
  }
}

/**
 * Per-request context: override the User-Agent. When omitted, a UA is chosen
 * automatically based on the URL (identifying UA for SEC, rotating UA elsewhere).
 */
export type DownloadOptions = {
  userAgent?: string;
};

/** Resolve the effective UA: explicit override > URL-based auto-pick. */
const resolveUa = (url: string, opts: DownloadOptions) =>
  opts.userAgent ?? pickUserAgent(url);

const PDF_MAGIC = "%PDF";
const MIN_PDF_SIZE = 1000;

const isPdf = (buf: Buffer): boolean =>
  buf.length >= MIN_PDF_SIZE && buf.subarray(0, 4).toString() === PDF_MAGIC;

// ── Lazy browser singleton ──

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  console.log("[download] Launching headless browser…");
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-extensions",
    ],
  });
  console.log("[download] Browser launched.");
  return _browser;
}

async function newContext(userAgent?: string): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    acceptDownloads: true,
    userAgent: userAgent ?? FALLBACK_USER_AGENT,
  });
}

/** Gracefully close the browser (call on process shutdown). */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

// ── Tier 1: Direct fetch ──

async function directFetch(url: string, userAgent?: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent ?? FALLBACK_USER_AGENT },
      redirect: "follow",
    });

    if (!res.ok) {
      console.warn(`[download] Direct fetch failed: ${res.status} for ${url}`);
      return null;
    }

    const ct = res.headers.get("content-type") ?? "";
    const looksLikePdf =
      ct.includes("pdf") || ct.includes("octet-stream") || !ct.includes("html");

    if (!looksLikePdf) {
      console.warn(`[download] Direct fetch returned HTML for ${url} (possible bot protection)`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (isPdf(buffer)) {
      console.log(`[download] Direct fetch OK for ${url} (${buffer.length} bytes)`);
      return buffer;
    }

    console.warn(`[download] Direct fetch returned non-PDF content for ${url} (${buffer.length} bytes)`);
    return null;
  } catch (err) {
    console.warn(`[download] Direct fetch error for ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Tier 2: Browser context fetch (stealth, with cookies/JS) ──

async function browserContextFetch(url: string, userAgent?: string): Promise<Buffer | null> {
  const context = await newContext(userAgent);
  try {
    console.log(`[download] Trying browser context fetch for ${url}…`);
    const response = await context.request.get(url);
    const ct = response.headers()["content-type"] ?? "";

    if (response.ok() && (ct.includes("pdf") || ct.includes("octet-stream"))) {
      const buffer = await response.body();
      if (isPdf(buffer)) {
        console.log(`[download] Browser context fetch OK for ${url} (${buffer.length} bytes)`);
        return buffer;
      }
    }
    return null;
  } catch (err) {
    console.warn(`[download] Browser context fetch error:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    await context.close();
  }
}

// ── Tier 3: Full browser navigation + response interception + download event ──

async function browserNavigationDownload(url: string, userAgent?: string): Promise<Buffer | null> {
  const context = await newContext(userAgent);
  const page = await context.newPage();
  try {
    console.log(`[download] Navigating browser to ${url}…`);

    let isDownloaded = false;
    let downloadError: unknown = null;
    let downloadObject: any = null;
    let interceptedPdfBuffer: Buffer | null = null;

    // Intercept responses — capture the largest PDF content served during navigation
    page.on("response", async (response) => {
      const ct = response.headers()["content-type"] ?? "";
      if (ct.includes("application/pdf")) {
        try {
          const body = await response.body();
          if (isPdf(body) && body.length > (interceptedPdfBuffer?.length ?? 0)) {
            console.log(`[download] Intercepted PDF response from ${response.url().substring(0, 100)} (${body.length} bytes)`);
            interceptedPdfBuffer = body;
          }
        } catch { /* response body may not be available */ }
      }
    });

    page.on("download", async (download) => {
      try {
        downloadObject = download;
        await download.path();
        isDownloaded = true;
      } catch (error) {
        downloadError = error;
      }
    });

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    } catch {
      // Navigation may fail/timeout if a download starts — that's OK
    }

    // Wait up to 15s for a download event or intercepted PDF
    let tries = 0;
    while (!isDownloaded && !interceptedPdfBuffer && downloadError === null && tries < 15) {
      await new Promise((r) => setTimeout(r, 1000));
      tries++;
    }

    // Priority: download event > intercepted response > embedded iframe
    if (isDownloaded && downloadObject) {
      const tempPath = await downloadObject.path();
      if (tempPath) {
        const buffer = fs.readFileSync(tempPath);
        console.log(`[download] Browser download event OK for ${url} (${buffer.length} bytes)`);
        return buffer;
      }
    }

    if (interceptedPdfBuffer) return interceptedPdfBuffer;

    // Check for embedded PDF in iframe/embed/object
    const embeddedPdfUrl = await page.evaluate(() => {
      for (const el of document.querySelectorAll("iframe, embed, object")) {
        const src = el.getAttribute("src") || el.getAttribute("data") || "";
        // Look for direct PDF URLs or PDF viewer URLs with a file= parameter
        const fileMatch = src.match(/[?&]file=([^&]+)/);
        if (fileMatch) {
          const fileUrl = decodeURIComponent(fileMatch[1]);
          if (fileUrl.endsWith(".pdf")) return fileUrl;
        }
        if (src.endsWith(".pdf")) return src;
      }
      return null;
    });

    if (embeddedPdfUrl) {
      // Resolve relative URLs
      const resolvedUrl = embeddedPdfUrl.startsWith("//")
        ? `https:${embeddedPdfUrl}`
        : embeddedPdfUrl.startsWith("http")
          ? embeddedPdfUrl
          : new URL(embeddedPdfUrl, url).href;

      console.log(`[download] Found embedded PDF URL: ${resolvedUrl}`);
      const res = await context.request.get(resolvedUrl);
      if (res.ok()) {
        const buffer = await res.body();
        if (isPdf(buffer)) {
          console.log(`[download] Embedded PDF fetched OK (${buffer.length} bytes)`);
          return buffer;
        }
      }
    }

    if (downloadError) {
      console.warn(`[download] Browser download error:`, downloadError);
    } else {
      console.warn(`[download] Browser navigation: no PDF found for ${url}`);
    }
    return null;
  } finally {
    await context.close();
  }
}

// ── Public API ──

/**
 * Download a PDF from a URL with tiered fallback:
 *   1. Direct fetch with browser User-Agent + PDF validation
 *   2. Stealth browser context fetch (handles cookies/JS redirects)
 *   3. Full browser navigation with download event listener (handles click-to-download pages)
 */
export async function downloadPdfFromUrl(
  url: string,
  opts: DownloadOptions = {},
): Promise<Buffer> {
  const userAgent = resolveUa(url, opts);

  // Tier 1
  const direct = await directFetch(url, userAgent);
  if (direct) return direct;

  // Tier 2
  const contextResult = await browserContextFetch(url, userAgent);
  if (contextResult) return contextResult;

  // Tier 3
  const navResult = await browserNavigationDownload(url, userAgent);
  if (navResult) return navResult;

  throw new Error(`Failed to download PDF from ${url} — all tiers exhausted`);
}

// ── HTML extraction ──

/**
 * Strip scripts, styles, tracking elements, and return cleaned HTML with
 * a title extracted from <title>, og:title, or the first <h1>.
 */
function cleanHtml(rawHtml: string): { html: string; title: string } {
  const $ = cheerio.load(rawHtml);

  // Extract title before stripping
  const title =
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    "";

  // Strip noise
  $("script, style, noscript, link[rel='stylesheet'], iframe[src*='googletagmanager'], iframe[src*='doubleclick']").remove();
  $("[onclick], [onload], [onerror]").removeAttr("onclick").removeAttr("onload").removeAttr("onerror");

  // Normalize: keep <html>, <head><meta>, <body>
  $("head").children().not("meta, title, base").remove();

  return { html: $.html(), title };
}

/**
 * Fetch HTML from a URL using the stealth browser — JS gets executed, cookies
 * flow naturally, and we bypass common bot protection. Direct fetch is skipped
 * because HTML sites commonly serve bot-detection stubs (e.g. SEC.gov) which
 * are indistinguishable from real content via headers alone.
 */
export async function downloadHtmlFromUrl(
  url: string,
  opts: DownloadOptions = {},
): Promise<{ html: string; title: string }> {
  const userAgent = resolveUa(url, opts);
  const context = await newContext(userAgent);
  const page = await context.newPage();
  try {
    console.log(`[download] Rendering HTML via browser for ${url}…`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    } catch {
      // Timeouts on networkidle are common on heavy pages — we still read the DOM
    }

    const rawHtml = await page.content();
    console.log(`[download] Browser rendered ${rawHtml.length} bytes of HTML`);
    return cleanHtml(rawHtml);
  } finally {
    await context.close();
  }
}

// ── Unified download ──

export type DownloadResult =
  | { type: "pdf"; buffer: Buffer }
  | { type: "html"; html: string; title: string };

/**
 * Download a URL, auto-detecting PDF vs HTML. Uses the same browser-based
 * bot protection bypass for both types. For HTML, returns the cleaned
 * rendered DOM; for PDFs, returns the binary buffer.
 */
export async function downloadFromUrl(
  url: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  // Quick probe to classify content type
  let contentType = "";
  try {
    const head = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": resolveUa(url, opts) },
      redirect: "follow",
    });
    contentType = head.headers.get("content-type") ?? "";
  } catch {
    // HEAD may be unsupported — fall through to GET-based detection
  }

  if (contentType.includes("application/pdf")) {
    const buffer = await downloadPdfFromUrl(url, opts);
    return { type: "pdf", buffer };
  }

  if (contentType.includes("text/html")) {
    // Still try PDF first if the URL itself suggests a PDF (common pattern:
    // HTML viewer pages that embed a PDF — our browser tier finds the PDF)
    if (/\.pdf(\?|$|#)/i.test(url) || /\/pdf(\?|$|#)/i.test(url)) {
      try {
        const buffer = await downloadPdfFromUrl(url, opts);
        return { type: "pdf", buffer };
      } catch {
        // Fall through to HTML
      }
    }
    const { html, title } = await downloadHtmlFromUrl(url, opts);
    return { type: "html", html, title };
  }

  // Unknown / no content-type: try PDF first (our main use case), then HTML
  try {
    const buffer = await downloadPdfFromUrl(url, opts);
    return { type: "pdf", buffer };
  } catch {
    const { html, title } = await downloadHtmlFromUrl(url, opts);
    return { type: "html", html, title };
  }
}
