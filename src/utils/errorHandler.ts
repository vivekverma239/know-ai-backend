import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { logger, logError } from "@/utils/logger";
import { getRequestId, getRequestContext } from "@/utils/requestContext";

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    isOperational = true,
    context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Database operation errors
 */
export class DatabaseError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 500, true, { ...context, errorType: "database" });
  }
}

/**
 * Validation errors (client input)
 */
export class ValidationError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 400, true, { ...context, errorType: "validation" });
  }
}

/**
 * External API call errors
 */
export class ExternalAPIError extends AppError {
  constructor(
    message: string,
    statusCode = 502,
    context: Record<string, unknown> = {}
  ) {
    super(message, statusCode, true, { ...context, errorType: "external_api" });
  }
}

/**
 * Authentication errors
 */
export class AuthenticationError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 401, true, { ...context, errorType: "authentication" });
  }
}

/**
 * Authorization errors
 */
export class AuthorizationError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 403, true, { ...context, errorType: "authorization" });
  }
}

/**
 * Not found errors
 */
export class NotFoundError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 404, true, { ...context, errorType: "not_found" });
  }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 429, true, { ...context, errorType: "rate_limit" });
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 504, true, { ...context, errorType: "timeout" });
  }
}

/**
 * Determine if an error is operational (expected) or a programming error
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Get appropriate status code from error
 */
export function getStatusCode(error: Error | FastifyError | AppError): number {
  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 500;
}

/**
 * Sanitize error message for client response
 * Don't expose internal details in production
 */
export function sanitizeErrorMessage(error: Error | AppError, isDevelopment: boolean): string {
  // If it's an operational error, we can expose the message
  if (error instanceof AppError && error.isOperational) {
    return error.message;
  }

  // In development, expose all error messages
  if (isDevelopment) {
    return error.message;
  }

  // In production, hide programming errors
  return "Internal server error";
}

/**
 * Create error response object
 */
export function createErrorResponse(
  error: Error | AppError,
  requestId?: string,
  isDevelopment = false
): Record<string, unknown> {
  type ErrorResponse = {
    error: {
      message: string;
      requestId: string;
      type?: string;
      name?: string;
      stack?: string;
      context?: unknown;
    };
  };

  const response: ErrorResponse = {
    error: {
      message: sanitizeErrorMessage(error, isDevelopment),
      requestId: requestId || "unknown",
    },
  };

  // Add error type if it's an AppError
  if (error instanceof AppError) {
    const errorType =
      typeof error.context.errorType === "string"
        ? error.context.errorType
        : "application_error";
    response.error = {
      ...response.error,
      type: errorType,
    };
  }

  // In development, add more details
  if (isDevelopment) {
    response.error = {
      ...response.error,
      name: error.name,
      stack: error.stack,
      ...(error instanceof AppError ? { context: error.context } : {}),
    };
  }

  return response;
}

/**
 * Global error handler for Fastify
 * This should be registered with fastify.setErrorHandler()
 */
export function createErrorHandler(fastify: FastifyInstance): void {
  const isDevelopment = process.env.NODE_ENV !== "production";

  fastify.setErrorHandler(
    async (error: FastifyError | Error | AppError, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = getRequestId();
      const requestContext = getRequestContext();
      const statusCode = getStatusCode(error);

      // Log the error with full context
      const errorContext = {
        requestId,
        path: request.url,
        method: request.method,
        statusCode,
        userId: requestContext?.userId,
        sessionId: requestContext?.sessionId,
        ...(error instanceof AppError ? error.context : {}),
      };

      // Use appropriate log level based on error type
      if (statusCode >= 500) {
        logError(error, errorContext);
      } else if (statusCode >= 400) {
        logger.warn(error.message, errorContext);
      } else {
        logger.info(error.message, errorContext);
      }

      // Create sanitized error response
      const errorResponse = createErrorResponse(error, requestId, isDevelopment);

      // Send response
      return reply.status(statusCode).send(errorResponse);
    }
  );

  // Also handle promise rejections
  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Promise Rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught Exception", {
      error: error.message,
      stack: error.stack,
    });

    // In production, exit the process
    if (!isDevelopment) {
      process.exit(1);
    }
  });
}

/**
 * Async error wrapper for route handlers
 * Use this to wrap async route handlers to ensure errors are caught
 */
export function asyncHandler<T>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<T> => {
      return await handler(request, reply);
  };
}

/**
 * Try-catch wrapper that logs and rethrows errors
 * Use this for critical operations where you want to log but not handle the error
 */
export async function tryWithLogging<T>(
  operation: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logError(error, {
      ...context,
      operation,
      requestId: getRequestId(),
    });
    throw error;
  }
}
