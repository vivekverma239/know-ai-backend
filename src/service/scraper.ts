import { logger } from "@/utils/logger";

export interface ScraperResult {
    url: string;
    success: boolean;
    downloadUrl?: string;
    markdown?: string;
    error?: string;
}

export interface BulkScrapeResponse<T extends ScraperResult> {
    success: boolean;
    results: T[];
}

export class ScraperService {
    private readonly baseUrl: string;
    private readonly apiKey: string;

    constructor() {
        this.baseUrl = process.env.SCRAPER_SERVICE_URL || "";
        this.apiKey = process.env.SCRAPER_SERVICE_API_KEY || "";
    }

    private async fetch<T>(endpoint: string, body: any): Promise<T> {
        if (!this.baseUrl) {
            throw new Error("SCRAPER_SERVICE_URL is not defined");
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(
                `Scraper service error: ${response.status} ${response.statusText}`,
                {
                    error: errorText,
                    endpoint,
                },
            );
            throw new Error(`Scraper service failed: ${response.statusText}`);
        }

        return response.json() as Promise<T>;
    }

    async scrapePdfBulk(urls: string[]): Promise<ScraperResult[]> {
        if (urls.length === 0) return [];

        try {
            const response = await this.fetch<BulkScrapeResponse<ScraperResult>>(
                "/api/scrape/pdf/bulk",
                { urls },
            );
            return response.results;
        } catch (error) {
            console.log("error", error);
            logger.error("Failed to scrape PDFs in bulk", { error, urls });
            return urls.map((url) => ({ url, success: false, error: String(error) }));
        }
    }

    async scrapeMarkdownBulk(urls: string[]): Promise<ScraperResult[]> {
        if (urls.length === 0) return [];

        try {
            const response = await this.fetch<BulkScrapeResponse<ScraperResult>>(
                "/api/scrape/markdown/bulk",
                { urls },
            );
            return response.results;
        } catch (error) {
            logger.error("Failed to scrape markdowns in bulk", { error, urls });
            return urls.map((url) => ({ url, success: false, error: String(error) }));
        }
    }

    async scrapePdf(url: string): Promise<ScraperResult> {
        try {
            const response = await this.fetch<{
                success: boolean;
                url: string;
                error?: string;
            }>("/api/scrape/pdf", { url });
            return {
                url,
                success: response.success,
                downloadUrl: response.url,
                error: response.error,
            };
        } catch (error) {
            return { url, success: false, error: String(error) };
        }
    }

    async scrapeMarkdown(url: string): Promise<ScraperResult> {
        try {
            const response = await this.fetch<{
                success: boolean;
                markdown: string;
                error?: string;
            }>("/api/scrape/markdown", { url });
            return {
                url,
                success: response.success,
                markdown: response.markdown,
                error: response.error,
            };
        } catch (error) {
            return { url, success: false, error: String(error) };
        }
    }

    async captureVisual(
        url: string,
        type: "pdf" | "screenshot",
    ): Promise<ScraperResult> {
        try {
            const response = await this.fetch<{
                success: boolean;
                url: string;
                error?: string;
            }>("/api/scrape/visual", { url, type });
            return {
                url,
                success: response.success,
                downloadUrl: response.url,
                error: response.error,
            };
        } catch (error) {
            return { url, success: false, error: String(error) };
        }
    }

    async convertMarkdownToPdf(
        markdown: string,
        style: "simple" | "academic" | "business" = "simple",
    ): Promise<ScraperResult> {
        try {
            const response = await this.fetch<{
                success: boolean;
                url: string;
                error?: string;
            }>("/api/convert/markdown-to-pdf", { markdown, style });
            return {
                url: "",
                success: response.success,
                downloadUrl: response.url,
                error: response.error,
            };
        } catch (error) {
            return { url: "", success: false, error: String(error) };
        }
    }
}

export const scraperService = new ScraperService();
