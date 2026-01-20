import pino from "pino";
import { AsyncLocalStorage } from "async_hooks";
import process from "process";

// Create async storage for context
const asyncStorage = new AsyncLocalStorage<Map<string, unknown>>();

// Import request context functions (with lazy loading to avoid circular deps)
let getRequestId: (() => string | undefined) | undefined;
let getContextForLogging: (() => Record<string, unknown>) | undefined;

// Lazy load request context functions
const loadRequestContext = () => {
  if (!getRequestId) {
    try {
      const requestContext = require("./requestContext");
      getRequestId = requestContext.getRequestId;
      getContextForLogging = requestContext.getContextForLogging;
    } catch (error) {
      // Request context not available, continue without it
    }
  }
};

// Import logging configuration
import { loggerConfig } from "@/config/logging";

// Create the base logger with configuration
const baseLogger = pino(loggerConfig);

/**
 * Helper to merge all context sources
 */
const getAllContext = (): Record<string, unknown> => {
  // Get AsyncLocalStorage context (legacy)
  const asyncContext = asyncStorage.getStore();
  const legacyContext = asyncContext ? Object.fromEntries(asyncContext.entries()) : {};

  // Get request context
  loadRequestContext();
  const requestContext = getContextForLogging ? getContextForLogging() : {};

  return { ...legacyContext, ...requestContext };
};

// Create the logger with context support
export const logger = {
  error: (message: string, meta: Record<string, unknown> = {}) => {
    const context = getAllContext();
    baseLogger.error({ ...context, ...meta }, message);
  },
  warn: (message: string, meta: Record<string, unknown> = {}) => {
    const context = getAllContext();
    baseLogger.warn({ ...context, ...meta }, message);
  },
  info: (message: string, meta: Record<string, unknown> = {}) => {
    const context = getAllContext();
    baseLogger.info({ ...context, ...meta }, message);
  },
  debug: (message: string, meta: Record<string, unknown> = {}) => {
    const context = getAllContext();
    baseLogger.debug({ ...context, ...meta }, message);
  },
};

// Context management functions
export function setLogContext(key: string, value: unknown): void {
  let store = asyncStorage.getStore();
  if (!store) {
    store = new Map();
    asyncStorage.enterWith(store);
  }
  store.set(key, value);
}

export function getLogContext(key: string): unknown {
  const store = asyncStorage.getStore();
  return store?.get(key);
}

export function clearLogContext(): void {
  const store = asyncStorage.getStore();
  if (store) {
    store.clear();
  }
}

// Middleware to automatically add request context
export async function withLogContext<T>(
  context: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const store = new Map(Object.entries(context));
  return asyncStorage.run(store, fn);
}

// Helper function to create a logger with fixed context
export function createContextLogger(context: Record<string, unknown>) {
  return {
    error: (message: string, meta: Record<string, unknown> = {}) => {
      logger.error(message, { ...meta, ...context });
    },
    warn: (message: string, meta: Record<string, unknown> = {}) => {
      logger.warn(message, { ...meta, ...context });
    },
    info: (message: string, meta: Record<string, unknown> = {}) => {
      logger.info(message, { ...meta, ...context });
    },
    debug: (message: string, meta: Record<string, unknown> = {}) => {
      logger.debug(message, { ...meta, ...context });
    },
  };
}

/**
 * Log an error with full context and stack trace
 * @param error The error object
 * @param context Additional context to include
 */
export function logError(error: Error | unknown, context?: Record<string, unknown>): void {
  if (error instanceof Error) {
    logger.error(error.message, {
      ...context,
      errorName: error.name,
      stack: error.stack,
      error: error.message,
    });
  } else {
    logger.error("Non-Error object thrown", {
      ...context,
      error: String(error),
    });
  }
}

/**
 * Log operation with duration
 * @param message Log message
 * @param startTime Operation start time
 * @param meta Additional metadata
 */
export function logWithDuration(
  message: string,
  startTime: Date,
  meta?: Record<string, unknown>
): void {
  const duration = Date.now() - startTime.getTime();
  logger.info(message, { ...meta, duration });
}

/**
 * Create a child logger with additional context
 * This is useful for creating loggers for specific subsystems
 * @param context Additional context to always include
 * @returns A new logger instance with the context
 */
export function createChildLogger(context: Record<string, unknown>) {
  return createContextLogger(context);
}

/**
 * Export base logger for advanced use cases
 */
export { baseLogger };
