import { AsyncLocalStorage } from "node:async_hooks";
import process from "node:process";
import { type AnyValue, type AnyValueMap, SeverityNumber, logs } from "@opentelemetry/api-logs";
import pino from "pino";

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
const otelLoggerName = process.env.OTEL_SERVICE_NAME || "knowsis-ai-backend";

type AppLogLevel = "error" | "warn" | "info" | "debug";

function toOtelSeverity(level: AppLogLevel): SeverityNumber {
  switch (level) {
    case "error":
      return SeverityNumber.ERROR;
    case "warn":
      return SeverityNumber.WARN;
    case "info":
      return SeverityNumber.INFO;
    case "debug":
      return SeverityNumber.DEBUG;
  }
}

function sanitizeForOtel(value: unknown, depth = 0): AnyValue {
  if (depth > 4) {
    return typeof value === "string" ? value : String(value);
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeForOtel(entry, depth + 1));
  }

  if (typeof value === "object") {
    const mappedValue: AnyValueMap = {};
    for (const [key, entry] of Object.entries(value)) {
      mappedValue[key] = sanitizeForOtel(entry, depth + 1);
    }
    return mappedValue;
  }

  return String(value);
}

function emitOpenTelemetryLog(
  level: AppLogLevel,
  message: string,
  meta: Record<string, unknown>,
): void {
  const isOtelEnabled =
    process.env.ENABLE_OPENTELEMETRY !== "false" &&
    process.env.ENABLE_OPENTELEMETRY_LOGS !== "false";

  if (!isOtelEnabled) {
    return;
  }

  try {
    const otelLogger = logs.getLogger(otelLoggerName, process.env.npm_package_version || "1.0.0");
    otelLogger.emit({
      severityNumber: toOtelSeverity(level),
      severityText: level.toUpperCase(),
      body: message,
      attributes: sanitizeForOtel(meta) as AnyValueMap,
    });
  } catch (_error) {
    // Logging should never throw
  }
}

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
    const payload = { ...context, ...meta };
    baseLogger.error(payload, message);
    emitOpenTelemetryLog("error", message, payload);
  },
  warn: (message: string, meta: Record<string, unknown> = {}) => {
    const context = getAllContext();
    const payload = { ...context, ...meta };
    baseLogger.warn(payload, message);
    emitOpenTelemetryLog("warn", message, payload);
  },
  info: (message: string, meta: Record<string, unknown> = {}) => {
    const context = getAllContext();
    const payload = { ...context, ...meta };
    baseLogger.info(payload, message);
    emitOpenTelemetryLog("info", message, payload);
  },
  debug: (message: string, meta: Record<string, unknown> = {}) => {
    const context = getAllContext();
    const payload = { ...context, ...meta };
    baseLogger.debug(payload, message);
    emitOpenTelemetryLog("debug", message, payload);
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
  fn: () => Promise<T>,
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
  meta?: Record<string, unknown>,
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
