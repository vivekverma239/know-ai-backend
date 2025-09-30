import pino from "pino";
import { AsyncLocalStorage } from "async_hooks";
import process from "process";

// Create async storage for context
const asyncStorage = new AsyncLocalStorage<Map<string, unknown>>();

// Create the base logger
const baseLogger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  base: { service: "agents-app" },
  timestamp: true,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

// Create the logger with context support
export const logger = {
  error: (message: string, meta: Record<string, unknown> = {}) => {
    const context = asyncStorage.getStore();
    baseLogger.error(
      { ...meta, ...Object.fromEntries(context?.entries() ?? []) },
      message
    );
  },
  warn: (message: string, meta: Record<string, unknown> = {}) => {
    const context = asyncStorage.getStore();
    baseLogger.warn(
      { ...meta, ...Object.fromEntries(context?.entries() ?? []) },
      message
    );
  },
  info: (message: string, meta: Record<string, unknown> = {}) => {
    const context = asyncStorage.getStore();
    baseLogger.info(
      { ...meta, ...Object.fromEntries(context?.entries() ?? []) },
      message
    );
  },
  debug: (message: string, meta: Record<string, unknown> = {}) => {
    const context = asyncStorage.getStore();
    baseLogger.debug(
      { ...meta, ...Object.fromEntries(context?.entries() ?? []) },
      message
    );
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
