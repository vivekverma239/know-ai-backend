import { AsyncLocalStorage } from "node:async_hooks";
import { v4 as uuidv4 } from "uuid";
import type { FastifyRequest } from "fastify";

/**
 * Request context containing correlation ID and metadata for distributed tracing
 */
export interface RequestContext {
  /** Unique identifier for this request (UUID v4) */
  requestId: string;

  /** User ID if available from headers or auth */
  userId?: string;

  /** Session ID if available */
  sessionId?: string;

  /** Organization ID if available */
  orgId?: string;

  /** Request path */
  path: string;

  /** HTTP method */
  method: string;

  /** Request start timestamp */
  timestamp: Date;

  /** Additional metadata that can be added during request processing */
  metadata: Record<string, unknown>;
}

// Create async storage for request context
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Initialize request context from a Fastify request
 * This should be called at the start of each request
 */
export function initRequestContext(request: FastifyRequest): RequestContext {
  const context: RequestContext = {
    requestId: uuidv4(),
    userId: extractUserId(request),
    sessionId: extractSessionId(request),
    orgId: extractOrgId(request),
    path: request.url,
    method: request.method,
    timestamp: new Date(),
    metadata: {},
  };

  return context;
}

/**
 * Run a function within a request context
 */
export async function withRequestContext<T>(
  context: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return requestContextStorage.run(context, fn);
}

/**
 * Get the current request ID
 * @returns The request ID if available, undefined otherwise
 */
export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

/**
 * Get the full request context
 * @returns The request context if available, undefined otherwise
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Set additional metadata on the current request context
 * @param key Metadata key
 * @param value Metadata value
 */
export function setRequestMetadata(key: string, value: unknown): void {
  const context = requestContextStorage.getStore();
  if (context) {
    context.metadata[key] = value;
  }
}

/**
 * Get metadata from the current request context
 * @param key Metadata key
 * @returns The metadata value if found, undefined otherwise
 */
export function getRequestMetadata(key: string): unknown {
  const context = requestContextStorage.getStore();
  return context?.metadata[key];
}

/**
 * Get all metadata from the current request context
 * @returns The metadata object
 */
export function getAllRequestMetadata(): Record<string, unknown> {
  const context = requestContextStorage.getStore();
  return context?.metadata ?? {};
}

/**
 * Extract user ID from request headers
 * Looks for common header patterns used in the application
 */
function extractUserId(request: FastifyRequest): string | undefined {
  // Check common header names
  const userId =
    (request.headers["x-user-id"] as string) ||
    (request.headers["user-id"] as string) ||
    undefined;

  return userId;
}

/**
 * Extract session ID from request headers
 */
function extractSessionId(request: FastifyRequest): string | undefined {
  const sessionId =
    (request.headers["x-session-id"] as string) ||
    (request.headers["session-id"] as string) ||
    undefined;

  return sessionId;
}

/**
 * Extract organization ID from request headers
 */
function extractOrgId(request: FastifyRequest): string | undefined {
  const orgId =
    (request.headers["x-org-id"] as string) ||
    (request.headers["org-id"] as string) ||
    undefined;

  return orgId;
}

/**
 * Get context information for logging
 * Returns an object with all context fields suitable for inclusion in logs
 */
export function getContextForLogging(): Record<string, unknown> {
  const context = requestContextStorage.getStore();
  if (!context) {
    return {};
  }

  return {
    requestId: context.requestId,
    userId: context.userId,
    sessionId: context.sessionId,
    orgId: context.orgId,
    path: context.path,
    method: context.method,
    ...context.metadata,
  };
}

/**
 * Export the storage for advanced use cases
 */
export { requestContextStorage };
