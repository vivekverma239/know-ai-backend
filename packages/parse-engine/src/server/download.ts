import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext } from "playwright";
import fs from "node:fs";

chromium.use(StealthPlugin());

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

async function newContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    acceptDownloads: true,
    userAgent: BROWSER_USER_AGENT,
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

async function directFetch(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
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

async function browserContextFetch(url: string): Promise<Buffer | null> {
  const context = await newContext();
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

async function browserNavigationDownload(url: string): Promise<Buffer | null> {
  const context = await newContext();
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
export async function downloadPdfFromUrl(url: string): Promise<Buffer> {
  // Tier 1
  const direct = await directFetch(url);
  if (direct) return direct;

  // Tier 2
  const contextResult = await browserContextFetch(url);
  if (contextResult) return contextResult;

  // Tier 3
  const navResult = await browserNavigationDownload(url);
  if (navResult) return navResult;

  throw new Error(`Failed to download PDF from ${url} — all tiers exhausted`);
}
