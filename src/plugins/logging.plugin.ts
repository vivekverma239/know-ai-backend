import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { logger } from "@/utils/logger";
import {
  initRequestContext,
  withRequestContext,
  getRequestId,
  getRequestContext,
  type RequestContext,
} from "@/utils/requestContext";

/**
 * Extended FastifyRequest with logging properties
 */
interface ExtendedFastifyRequest extends FastifyRequest {
  startTime?: number;
  requestContext?: RequestContext;
}

export interface LoggingPluginOptions {
  /** Log level for request/response logs */
  logLevel?: "debug" | "info" | "warn" | "error";

  /** Headers to sanitize from logs (e.g., authorization, cookie) */
  sanitizeHeaders?: string[];

  /** Paths to skip logging (e.g., health checks, metrics) */
  skipPaths?: string[];

  /** Whether to include request body in logs (only for debugging) */
  includeRequestBody?: boolean;

  /** Threshold in ms for logging slow requests */
  slowRequestThreshold?: number;
}

/**
 * Fastify plugin for request/response logging with correlation IDs
 * This plugin automatically:
 * - Generates a unique requestId for each request
 * - Logs request start with method, path, userId, sessionId
 * - Logs response completion with status, duration, requestId
 * - Adds X-Request-ID header to responses
 * - Detects and logs slow requests
 */
const loggingPlugin: FastifyPluginAsync<LoggingPluginOptions> = async (
  fastify,
  options
) => {
  const {
    logLevel = "info",
    sanitizeHeaders = ["authorization", "cookie", "x-api-key"],
    skipPaths = ["/api/v1/health", "/metrics", "/docs"],
    includeRequestBody = false,
    slowRequestThreshold = 5000, // 5 seconds
  } = options;

  /**
   * Check if a path should be skipped from logging
   */
  const shouldSkipPath = (path: string): boolean => {
    return skipPaths.some((skipPath) => path.startsWith(skipPath));
  };

  /**
   * Sanitize headers for logging (remove sensitive data)
   */
  const sanitizeHeadersForLogging = (
    headers: FastifyRequest["headers"]
  ): Record<string, unknown> => {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (sanitizeHeaders.includes(key.toLowerCase())) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  };

  /**
   * onRequest hook - Initialize request context and log request start
   */
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip logging for specified paths
    if (shouldSkipPath(request.url)) {
      return;
    }

    // Initialize request context
    const context = initRequestContext(request);

    // Store context and run within it
    await withRequestContext(context, async () => {
      // Log request start
      logger.info("Request started", {
        requestId: context.requestId,
        method: context.method,
        path: context.path,
        userId: context.userId,
        sessionId: context.sessionId,
        orgId: context.orgId,
        userAgent: request.headers["user-agent"],
        ip: request.ip,
        ...(includeRequestBody && request.body
          ? { body: JSON.stringify(request.body).substring(0, 500) }
          : {}),
      });
    });

    // Store start time for duration calculation
    (request as ExtendedFastifyRequest).startTime = Date.now();

    // Store context on request for access in other hooks
    (request as ExtendedFastifyRequest).requestContext = context;
  });

  /**
   * onResponse hook - Log response completion with duration
   */
  fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip logging for specified paths
    if (shouldSkipPath(request.url)) {
      return;
    }

    const extRequest = request as ExtendedFastifyRequest;
    const startTime = extRequest.startTime;
    const context = extRequest.requestContext;

    if (!startTime || !context) {
      return;
    }

    const duration = Date.now() - startTime;
    const isSlow = duration > slowRequestThreshold;

    // Add X-Request-ID header to response
    reply.header("X-Request-ID", context.requestId);

    // Run within the same request context
    await withRequestContext(context, async () => {
      const logMethod = isSlow ? logger.warn : logger.info;
      const logMessage = isSlow
        ? "Slow request completed"
        : "Request completed";

      logMethod(logMessage, {
        requestId: context.requestId,
        method: context.method,
        path: context.path,
        statusCode: reply.statusCode,
        duration,
        userId: context.userId,
        sessionId: context.sessionId,
        ...(isSlow ? { slowRequestThreshold } : {}),
      });
    });
  });

  /**
   * onError hook - Log errors with full context
   */
  fastify.addHook("onError", async (request: FastifyRequest, reply: FastifyReply, error: Error) => {
    // Skip logging for specified paths
    if (shouldSkipPath(request.url)) {
      return;
    }

    const extRequest = request as ExtendedFastifyRequest;
    const context = extRequest.requestContext;
    const startTime = extRequest.startTime;
    const duration = startTime ? Date.now() - startTime : undefined;

    // If we have a context, log within it
    if (context) {
      await withRequestContext(context, async () => {
        logger.error("Request error", {
          requestId: context.requestId,
          method: context.method,
          path: context.path,
          error: error.message,
          errorName: error.name,
          stack: error.stack,
          userId: context.userId,
          sessionId: context.sessionId,
          duration,
        });
      });

      // Add X-Request-ID header to error response
      reply.header("X-Request-ID", context.requestId);
    } else {
      // Fallback logging without context
      logger.error("Request error (no context)", {
        method: request.method,
        path: request.url,
        error: error.message,
        errorName: error.name,
        stack: error.stack,
      });
    }
  });

  /**
   * Decorate request with helper to get current request ID
   */
  fastify.decorateRequest("getRequestId", function (this: FastifyRequest) {
    return (this as ExtendedFastifyRequest).requestContext?.requestId || getRequestId();
  });

  /**
   * Decorate request with helper to get full context
   */
  fastify.decorateRequest("getRequestContext", function (this: FastifyRequest) {
    return (this as ExtendedFastifyRequest).requestContext || getRequestContext();
  });
};

export default fp(loggingPlugin, {
  name: "logging-plugin",
  fastify: "5.x",
});
