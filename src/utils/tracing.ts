import { trace, context, type Span as OtelSpan, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { logger, logError } from "@/utils/logger";
import { getRequestId, getRequestContext } from "@/utils/requestContext";
import type { TokenUsage } from "@/utils/asyncHook";

/**
 * Span represents a single traced operation
 * This is our wrapper around OpenTelemetry spans
 */
export interface Span {
  /** Unique span identifier (OpenTelemetry span ID) */
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

  /** Internal OpenTelemetry span */
  _otelSpan?: OtelSpan;
}

/**
 * Trace Manager - Unified interface for distributed tracing
 * Now uses OpenTelemetry under the hood
 */
export class TraceManager {
  private static instance: TraceManager;
  private tracer: Tracer;
  private activeSpans: Map<string, Span>;

  private constructor() {
    this.tracer = trace.getTracer("knowsis-ai-backend", "1.0.0");
    this.activeSpans = new Map();
  }

  static getInstance(): TraceManager {
    if (!TraceManager.instance) {
      TraceManager.instance = new TraceManager();
    }
    return TraceManager.instance;
  }

  /**
   * Start a new span using OpenTelemetry
   */
  startSpan(name: string, metadata: Record<string, unknown> = {}): Span {
    const requestId = getRequestId();
    const requestContext = getRequestContext();

    // Start OpenTelemetry span
    const otelSpan = this.tracer.startSpan(name, {
      attributes: {
        ...metadata,
        "request.id": requestId || "unknown",
        "user.id": requestContext?.userId,
        "session.id": requestContext?.sessionId,
        "org.id": requestContext?.orgId,
      },
    });

    // Get span context for IDs
    const spanContext = otelSpan.spanContext();
    const parentSpanContext = trace.getSpan(context.active())?.spanContext();

    // Create our wrapper span
    const span: Span = {
      id: spanContext.spanId,
      name,
      parentId: parentSpanContext?.spanId,
      requestId,
      startTime: new Date(),
      metadata: {
        ...metadata,
        userId: requestContext?.userId,
        sessionId: requestContext?.sessionId,
        orgId: requestContext?.orgId,
      },
      status: "pending",
      _otelSpan: otelSpan,
    };

    // Store for later retrieval
    this.activeSpans.set(span.id, span);

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
    const span = this.activeSpans.get(spanId);

    if (!span) {
      logger.warn("Attempted to end non-existent span", { spanId });
      return;
    }

    span.endTime = new Date();
    span.duration = span.endTime.getTime() - span.startTime.getTime();
    span.status = span.status === "error" ? "error" : "success";
    span.metadata = { ...span.metadata, ...metadata };

    // Set attributes on OpenTelemetry span
    if (span._otelSpan) {
      Object.entries(metadata).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          span._otelSpan?.setAttribute(key, String(value));
        }
      });

      // Set status
      if (span.status === "error") {
        span._otelSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: span.error?.message,
        });
      } else {
        span._otelSpan.setStatus({ code: SpanStatusCode.OK });
      }

      // Add duration as attribute
      span._otelSpan.setAttribute("duration.ms", span.duration);

      // Add token usage if present
      if (span.tokenUsage) {
        span._otelSpan.setAttribute("llm.tokens.prompt", span.tokenUsage.promptTokens);
        span._otelSpan.setAttribute("llm.tokens.completion", span.tokenUsage.completionTokens);
        span._otelSpan.setAttribute("llm.tokens.total", span.tokenUsage.totalTokens);
        span._otelSpan.setAttribute("llm.model", span.tokenUsage.model);
      }

      // End OpenTelemetry span
      span._otelSpan.end();
    }

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

    // Clean up
    this.activeSpans.delete(spanId);
  }

  /**
   * Record an error in a span
   */
  recordError(spanId: string, error: Error | unknown): void {
    const span = this.activeSpans.get(spanId);

    if (!span) {
      logger.warn("Attempted to record error in non-existent span", { spanId });
      return;
    }

    span.status = "error";
    span.error = error instanceof Error ? error : new Error(String(error));

    // Record exception in OpenTelemetry span
    if (span._otelSpan) {
      span._otelSpan.recordException(span.error);
      span._otelSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: span.error.message,
      });
    }

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
    const span = this.activeSpans.get(spanId);

    if (!span) {
      logger.warn("Attempted to record token usage in non-existent span", { spanId });
      return;
    }

    span.tokenUsage = usage;

    // Add token usage as span attributes
    if (span._otelSpan) {
      span._otelSpan.setAttribute("llm.tokens.prompt", usage.promptTokens);
      span._otelSpan.setAttribute("llm.tokens.completion", usage.completionTokens);
      span._otelSpan.setAttribute("llm.tokens.total", usage.totalTokens);
      span._otelSpan.setAttribute("llm.model", usage.model);
    }

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
   * Get the currently active span from OpenTelemetry context
   */
  getActiveSpan(): Span | undefined {
    const activeOtelSpan = trace.getSpan(context.active());
    if (!activeOtelSpan) {
      return undefined;
    }

    const spanId = activeOtelSpan.spanContext().spanId;
    return this.activeSpans.get(spanId);
  }

  /**
   * Get all spans in the current trace
   */
  getAllSpans(): Span[] {
    return Array.from(this.activeSpans.values());
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

    // Create OpenTelemetry context with this span as active
    const otelContext = span._otelSpan
      ? trace.setSpan(context.active(), span._otelSpan)
      : context.active();

    return context.with(otelContext, async () => {
      try {
        const result = await fn(span);
        this.endSpan(span.id);
        return result;
      } catch (error) {
        this.recordError(span.id, error);
        this.endSpan(span.id);
        throw error;
      }
    });
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
    // OpenTelemetry handles trace context automatically
    // We just need to start a root span
    return this.withSpan(traceId, async () => fn(), metadata);
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
  return (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) => {
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
export function traced<TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => Promise<TResult>,
  metadata?: Record<string, unknown>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return traceManager.withSpan<TResult>(name, async () => fn(...args), metadata);
  };
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
 * Get the OpenTelemetry tracer for advanced use cases
 */
export function getTracer(): Tracer {
  return trace.getTracer("knowsis-ai-backend", "1.0.0");
}
