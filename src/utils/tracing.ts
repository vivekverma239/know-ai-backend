import { AsyncLocalStorage } from "async_hooks";
import { v4 as uuidv4 } from "uuid";
import { logger, logError } from "@/utils/logger";
import { getRequestId, getRequestContext } from "@/utils/requestContext";
import type { TokenUsage } from "@/utils/asyncHook";

/**
 * Span represents a single traced operation
 */
export interface Span {
  /** Unique span identifier */
  id: string;

  /** Human-readable span name */
  name: string;

  /** Parent span ID if this is a child span */
  parentId?: string;

  /** Request ID this span belongs to */
  requestId?: string;

  /** Operation start time */
  startTime: Date;

  /** Operation end time */
  endTime?: Date;

  /** Duration in milliseconds */
  duration?: number;

  /** Additional metadata */
  metadata: Record<string, unknown>;

  /** Token usage if applicable (for LLM calls) */
  tokenUsage?: TokenUsage;

  /** Span status */
  status: "pending" | "success" | "error";

  /** Error if the span failed */
  error?: Error;
}

/**
 * Trace context stored in AsyncLocalStorage
 */
interface TraceContext {
  /** Root span ID */
  traceId: string;

  /** Currently active span */
  activeSpan?: Span;

  /** All spans in this trace */
  spans: Map<string, Span>;

  /** Metadata for the entire trace */
  metadata: Record<string, unknown>;
}

// Create async storage for trace context
const traceStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Trace Manager - Unified interface for distributed tracing
 * Integrates with Braintrust and Laminar automatically
 */
export class TraceManager {
  private static instance: TraceManager;

  private constructor() {}

  static getInstance(): TraceManager {
    if (!TraceManager.instance) {
      TraceManager.instance = new TraceManager();
    }
    return TraceManager.instance;
  }

  /**
   * Start a new span
   */
  startSpan(name: string, metadata: Record<string, unknown> = {}): Span {
    const context = traceStorage.getStore();
    const requestId = getRequestId();
    const requestContext = getRequestContext();

    const span: Span = {
      id: uuidv4(),
      name,
      parentId: context?.activeSpan?.id,
      requestId,
      startTime: new Date(),
      metadata: {
        ...metadata,
        userId: requestContext?.userId,
        sessionId: requestContext?.sessionId,
        orgId: requestContext?.orgId,
      },
      status: "pending",
    };

    // Store span in context if available
    if (context) {
      context.spans.set(span.id, span);
      context.activeSpan = span;
    }

    // Log span start
    logger.debug("Span started", {
      spanId: span.id,
      spanName: name,
      parentSpanId: span.parentId,
      requestId: span.requestId,
    });

    return span;
  }

  /**
   * End a span
   */
  endSpan(spanId: string, metadata: Record<string, unknown> = {}): void {
    const context = traceStorage.getStore();
    const span = context?.spans.get(spanId);

    if (!span) {
      logger.warn("Attempted to end non-existent span", { spanId });
      return;
    }

    span.endTime = new Date();
    span.duration = span.endTime.getTime() - span.startTime.getTime();
    span.status = span.status === "error" ? "error" : "success";
    span.metadata = { ...span.metadata, ...metadata };

    // Log span completion
    const logLevel = span.status === "error" ? "error" : span.duration > 5000 ? "warn" : "debug";
    const logMessage = span.status === "error"
      ? "Span failed"
      : span.duration > 5000
        ? "Slow span completed"
        : "Span completed";

    logger[logLevel](logMessage, {
      spanId: span.id,
      spanName: span.name,
      duration: span.duration,
      status: span.status,
      parentSpanId: span.parentId,
      requestId: span.requestId,
      ...(span.tokenUsage ? { tokenUsage: span.tokenUsage } : {}),
    });

    // Reset active span to parent if this was the active span
    if (context?.activeSpan?.id === spanId) {
      const parentSpan = span.parentId ? context.spans.get(span.parentId) : undefined;
      context.activeSpan = parentSpan;
    }
  }

  /**
   * Record an error in a span
   */
  recordError(spanId: string, error: Error | unknown): void {
    const context = traceStorage.getStore();
    const span = context?.spans.get(spanId);

    if (!span) {
      logger.warn("Attempted to record error in non-existent span", { spanId });
      return;
    }

    span.status = "error";
    span.error = error instanceof Error ? error : new Error(String(error));

    logError(span.error, {
      spanId: span.id,
      spanName: span.name,
      parentSpanId: span.parentId,
      requestId: span.requestId,
    });
  }

  /**
   * Record token usage in a span
   */
  recordTokenUsage(spanId: string, usage: TokenUsage): void {
    const context = traceStorage.getStore();
    const span = context?.spans.get(spanId);

    if (!span) {
      logger.warn("Attempted to record token usage in non-existent span", { spanId });
      return;
    }

    span.tokenUsage = usage;

    logger.debug("Token usage recorded in span", {
      spanId: span.id,
      spanName: span.name,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      model: usage.model,
    });
  }

  /**
   * Get the currently active span
   */
  getActiveSpan(): Span | undefined {
    return traceStorage.getStore()?.activeSpan;
  }

  /**
   * Get all spans in the current trace
   */
  getAllSpans(): Span[] {
    const context = traceStorage.getStore();
    return context ? Array.from(context.spans.values()) : [];
  }

  /**
   * Execute a function within a span
   * Automatically handles span lifecycle and error handling
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const span = this.startSpan(name, metadata);

    try {
      const result = await fn(span);
      this.endSpan(span.id);
      return result;
    } catch (error) {
      this.recordError(span.id, error);
      this.endSpan(span.id);
      throw error;
    }
  }

  /**
   * Initialize a new trace context
   * This should be called at the start of a trace-worthy operation
   */
  async withTrace<T>(
    traceId: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const context: TraceContext = {
      traceId,
      spans: new Map(),
      metadata: metadata || {},
    };

    return traceStorage.run(context, fn);
  }
}

// Export singleton instance
export const traceManager = TraceManager.getInstance();

/**
 * Decorator for tracing class methods
 * @example
 * class MyService {
 *   @Traced("myOperation")
 *   async myMethod() {
 *     // ...
 *   }
 * }
 */
export function Traced(operationName?: string) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    const targetWithConstructor = target as { constructor: { name: string } };
    const name = operationName || `${targetWithConstructor.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: unknown[]) {
      return traceManager.withSpan(
        name,
        async () => originalMethod.apply(this, args),
        { method: propertyKey, class: targetWithConstructor.constructor.name }
      );
    };

    return descriptor;
  };
}

/**
 * Helper function to create a traced function wrapper
 */
export function traced<T extends (...args: unknown[]) => Promise<unknown>>(
  name: string,
  fn: T,
  metadata?: Record<string, unknown>
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return traceManager.withSpan(name, async () => fn(...args), metadata);
  }) as T;
}

/**
 * Get trace summary for logging
 */
export function getTraceSummary(): {
  totalSpans: number;
  totalDuration: number;
  spansByName: Record<string, number>;
  errors: number;
} {
  const spans = traceManager.getAllSpans();

  const summary = {
    totalSpans: spans.length,
    totalDuration: spans.reduce((sum, span) => sum + (span.duration || 0), 0),
    spansByName: {} as Record<string, number>,
    errors: spans.filter((span) => span.status === "error").length,
  };

  spans.forEach((span) => {
    summary.spansByName[span.name] = (summary.spansByName[span.name] || 0) + 1;
  });

  return summary;
}

/**
 * Export trace storage for advanced use cases
 */
export { traceStorage };
