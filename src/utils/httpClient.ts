import { logError, logger } from "@/utils/logger";
import { getRequestId } from "@/utils/requestContext";
import { traceManager } from "@/utils/tracing";

/**
 * HTTP request configuration
 */
export interface RequestConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
}

/**
 * HTTP request options (simpler interface for common use cases)
 */
export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
}

/**
 * Traced HTTP Client - Instrumented HTTP client for external API calls
 * Automatically traces all HTTP requests with performance monitoring
 */
export class TracedHttpClient {
  private defaultTimeout = 30000; // 30 seconds
  private defaultRetries = 0;

  /**
   * Make a GET request
   */
  async get(url: string, options?: RequestOptions): Promise<Response> {
    return this.request({ url, method: "GET", ...options });
  }

  /**
   * Make a POST request
   */
  async post(url: string, body?: unknown, options?: RequestOptions): Promise<Response> {
    return this.request({ url, method: "POST", body, ...options });
  }

  /**
   * Make a PUT request
   */
  async put(url: string, body?: unknown, options?: RequestOptions): Promise<Response> {
    return this.request({ url, method: "PUT", body, ...options });
  }

  /**
   * Make a PATCH request
   */
  async patch(url: string, body?: unknown, options?: RequestOptions): Promise<Response> {
    return this.request({ url, method: "PATCH", body, ...options });
  }

  /**
   * Make a DELETE request
   */
  async delete(url: string, options?: RequestOptions): Promise<Response> {
    return this.request({ url, method: "DELETE", ...options });
  }

  /**
   * Make a generic HTTP request with tracing
   */
  async request(config: RequestConfig): Promise<Response> {
    const {
      url,
      method,
      headers = {},
      body,
      timeout = this.defaultTimeout,
      retries = this.defaultRetries,
    } = config;

    // Parse URL to extract host for logging
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;

    // Start a span for this HTTP request
    const span = traceManager.startSpan("http:request", {
      url: this.sanitizeUrl(url),
      method,
      host,
      requestId: getRequestId(),
    });

    let lastError: Error | undefined;
    let attemptCount = 0;

    while (attemptCount <= retries) {
      try {
        attemptCount++;

        // Add correlation headers
        const enrichedHeaders = {
          ...headers,
          "X-Request-ID": getRequestId() || "unknown",
          "User-Agent": "knowsis-ai-backend/1.0",
        };

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        // Make the request
        const response = await fetch(url, {
          method,
          headers: enrichedHeaders,
          body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Record successful span
        traceManager.endSpan(span.id, {
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get("content-type"),
          contentLength: response.headers.get("content-length"),
          attemptCount,
        });

        // Log warning for non-ok responses
        if (!response.ok) {
          logger.warn("External API call returned non-OK status", {
            url: this.sanitizeUrl(url),
            method,
            status: response.status,
            statusText: response.statusText,
            spanId: span.id,
            attemptCount,
          });
        } else {
          logger.debug("External API call successful", {
            url: this.sanitizeUrl(url),
            method,
            status: response.status,
            spanId: span.id,
            attemptCount,
          });
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if it's a timeout
        const isTimeout = lastError.name === "AbortError";

        logger.warn("External API call failed", {
          url: this.sanitizeUrl(url),
          method,
          error: lastError.message,
          isTimeout,
          attemptCount,
          retriesLeft: retries - attemptCount,
          spanId: span.id,
        });

        // If we have retries left, continue to next iteration
        if (attemptCount <= retries) {
          // Exponential backoff: 1s, 2s, 4s, etc.
          const backoffMs = Math.min(1000 * 2 ** (attemptCount - 1), 10000);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        // No more retries, record error and throw
        traceManager.recordError(span.id, lastError);
        traceManager.endSpan(span.id, {
          status: "error",
          attemptCount,
          errorType: isTimeout ? "timeout" : "fetch_error",
        });

        logError(lastError, {
          url: this.sanitizeUrl(url),
          method,
          spanId: span.id,
          attemptCount,
          operation: "httpClient:request",
        });

        throw lastError;
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError || new Error("Unknown error in HTTP request");
  }

  /**
   * Sanitize URL for logging (remove sensitive query params)
   */
  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const sensitiveParams = ["api_key", "apikey", "token", "secret", "password", "auth"];

      // Remove sensitive query parameters
      for (const param of sensitiveParams) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.set(param, "[REDACTED]");
        }
      }

      return parsed.toString();
    } catch {
      // If URL parsing fails, return as-is
      return url;
    }
  }

  /**
   * Make a request and parse JSON response
   */
  async requestJson<T = unknown>(config: RequestConfig): Promise<T> {
    const response = await this.request(config);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      throw new Error(`Expected JSON response, got ${contentType}`);
    }

    return (await response.json()) as T;
  }

  /**
   * Convenience method: GET and parse JSON
   */
  async getJson<T = unknown>(url: string, options?: RequestOptions): Promise<T> {
    return this.requestJson<T>({ url, method: "GET", ...options });
  }

  /**
   * Convenience method: POST and parse JSON
   */
  async postJson<T = unknown>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.requestJson<T>({ url, method: "POST", body, ...options });
  }
}

/**
 * Singleton instance of the HTTP client
 */
export const httpClient = new TracedHttpClient();

/**
 * Export default for convenience
 */
export default httpClient;
