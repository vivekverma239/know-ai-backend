import { scraperService } from "@/service/scraper";
import { StorageService } from "@/service/storage";
import crypto from "crypto";
import { logger } from "@/utils/logger";

const storage = new StorageService(); // Assuming instantiation needed

// Scraping app API URL - can be overridden via environment variable
const SCRAPING_APP_URL =
    process.env.SCRAPING_APP_URL ||
    "https://pdf-generator-api-z5z6k2buaq-de.a.run.app";

/**
 * Downloads PDFs from URLs using the NEW scraper service
 */
export const downloadPDFWithScraperService = async ({
    pdfSources,
}: {
    pdfSources: { url: string; fileId: string }[];
}) => {
    const urls = pdfSources.map((s) => s.url);
    const results = await scraperService.scrapePdfBulk(urls);

    console.log("results", results);
    const processedResults = await Promise.all(
        results.map(async (result, index) => {
            // index might not match if scraper returns results out of order or filtered?

            const source = pdfSources.find(s => s.url === result.url) || pdfSources[index];

            if (!result.success || !result.downloadUrl) {
                return {
                    id: source!.fileId,
                    storagePath: "",
                    url: result.url,
                    error: result.error || "Failed to scrape PDF",
                };
            }

            try {
                // Download from scraper service
                const response = await fetch(result.downloadUrl);
                if (!response.ok) throw new Error("Failed to download scraped PDF");
                const buffer = await response.arrayBuffer();

                // Upload to our storage
                const storagePath = `web-search/pdfs/${source!.fileId}.pdf`;
                await storage.uploadFile({
                    data: Buffer.from(buffer),
                    path: storagePath,
                    contentType: "application/pdf",
                });

                return {
                    id: source!.fileId,
                    storagePath: storagePath,
                    url: result.url,
                };
            } catch (error) {
                logger.error(`Error processing scraped PDF for ${result.url}:`, {
                    error: String(error),
                });
                return {
                    id: source!.fileId,
                    storagePath: "",
                    url: result.url,
                    error: String(error),
                };
            }
        }),
    );

    return processedResults.filter(
        (r): r is { id: string; storagePath: string; url: string } =>
            !!r.storagePath && !("error" in r),
    );
};

/**
 * Converts URLs to markdown using the NEW scraper service
 */
export const urlToMarkdownWithScraperService = async ({
    urls,
}: {
    urls: string[];
}) => {
    const results = await scraperService.scrapeMarkdownBulk(urls);

    const processedResults = await Promise.all(
        results.map(async (result) => {
            if (!result.success || !result.markdown) {
                return {
                    id: "",
                    storagePath: "",
                    url: result.url,
                    error: result.error || "Failed to scrape markdown",
                };
            }

            try {
                const urlHash = crypto
                    .createHash("sha256")
                    .update(result.url)
                    .digest("hex");
                const storagePath = `web-search/markdowns/${urlHash}.md`;

                // Upload to our storage
                await storage.uploadFile({
                    data: Buffer.from(result.markdown), // markdown is string
                    path: storagePath,
                    contentType: "text/markdown",
                });

                return {
                    id: urlHash,
                    storagePath: storagePath,
                    url: result.url,
                };
            } catch (error) {
                logger.error(`Error processing scraped markdown for ${result.url}:`, {
                    error: String(error),
                });
                return {
                    id: "",
                    storagePath: "",
                    url: result.url,
                    error: String(error),
                };
            }
        }),
    );

    return processedResults.filter(
        (r): r is { id: string; storagePath: string; url: string } =>
            !!r.storagePath && !!r.id && !("error" in r),
    );
};

/**
 * Downloads PDFs from URLs using the scraper service
 */
export const downloadPDFTask = async ({
    pdfSources,
}: {
    pdfSources: { url: string; fileId: string }[];
}) => {
    // Try using the new scraper service first if configured
    if (process.env.SCRAPER_SERVICE_URL) {
        return downloadPDFWithScraperService({ pdfSources });
    }

    // Fallback to the legacy service via fetch
    // Process all PDF downloads in parallel
    const promises = pdfSources.map(async (source) => {
        try {
            const response = await fetch(
                `${SCRAPING_APP_URL}/api/download-and-upload`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        url: source.url,
                        fileId: source.fileId,
                    }),
                },
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(
                    `Failed to download PDF: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`,
                );
            }

            const result = await response.json() as { success: boolean; error?: string; fileId: string; storagePath: string; url: string };

            if (!result.success) {
                throw new Error(result.error || "Failed to download PDF");
            }

            return {
                id: result.fileId,
                storagePath: result.storagePath,
                url: result.url,
            };
        } catch (error) {
            console.error(`Error downloading PDF for ${source.fileId}:`, error);
            // Return error result but don't throw to allow other downloads to continue
            return {
                id: source.fileId,
                storagePath: "",
                url: source.url,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    });

    const results = await Promise.all(promises);

    // Filter out failed results if needed, or return all with error info
    return results.filter(
        (r): r is { id: string; storagePath: string; url: string } =>
            !!r.storagePath && !("error" in r),
    );
};

/**
 * Converts URLs to markdown using the scraper service
 */
export const urlToMarkdownTask = async ({ urls }: { urls: string[] }) => {
    // Try using the new scraper service first if configured
    if (process.env.SCRAPER_SERVICE_URL) {
        return urlToMarkdownWithScraperService({ urls });
    }

    // Fallback to the legacy service
    // Process all URL conversions in parallel
    const promises = urls.map(async (url) => {
        try {
            const response = await fetch(`${SCRAPING_APP_URL}/api/url-to-markdown`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    url,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(
                    `Failed to convert URL to markdown: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`,
                );
            }

            const result = await response.json() as { success: boolean; error?: string; urlHash: string; storagePath: string; url: string };

            if (!result.success) {
                throw new Error(result.error || "Failed to convert URL to markdown");
            }

            return {
                id: result.urlHash,
                storagePath: result.storagePath,
                url: result.url,
            };
        } catch (error) {
            console.error(`Error converting URL to markdown for ${url}:`, error);
            // Return error result but don't throw to allow other conversions to continue
            return {
                id: "",
                storagePath: "",
                url,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    });

    const results = await Promise.all(promises);

    // Filter out failed results if needed, or return all with error info
    return results.filter(
        (r): r is { id: string; storagePath: string; url: string } =>
            !!r.storagePath && !!r.id && !("error" in r),
    );
};
