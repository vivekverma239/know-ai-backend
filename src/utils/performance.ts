import { logger } from "@/utils/logger";
import { traceManager } from "@/utils/tracing";

/**
 * Slow operation threshold in milliseconds
 * Operations taking longer than this will be logged as warnings
 */
const SLOW_OPERATION_THRESHOLD =
  Number.parseInt(process.env.SLOW_OPERATION_THRESHOLD_MS || "5000", 10);

/**
 * Critical operation threshold in milliseconds
 * Operations taking longer than this will be logged as errors
 */
const CRITICAL_OPERATION_THRESHOLD =
  Number.parseInt(process.env.CRITICAL_OPERATION_THRESHOLD_MS || "30000", 10);

/**
 * Measure and log operation duration
 * Use this for timing specific operations with automatic logging
 *
 * @example
 * const result = await timed("processReport", async () => {
 *   return await processStructuredReport({ reportId });
 * });
 */
export async function timed<T>(
  operationName: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  return traceManager.withSpan(
    operationName,
    async (span) => {
      const startTime = Date.now();

      try {
        const result = await fn();
        const duration = Date.now() - startTime;

        // Log based on duration
        if (duration > CRITICAL_OPERATION_THRESHOLD) {
          logger.error("Critical: Very slow operation detected", {
            operation: operationName,
            duration,
            threshold: CRITICAL_OPERATION_THRESHOLD,
            spanId: span.id,
            ...metadata,
          });
        } else if (duration > SLOW_OPERATION_THRESHOLD) {
          logger.warn("Slow operation detected", {
            operation: operationName,
            duration,
            threshold: SLOW_OPERATION_THRESHOLD,
            spanId: span.id,
            ...metadata,
          });
        } else {
          logger.debug("Operation completed", {
            operation: operationName,
            duration,
            spanId: span.id,
            ...metadata,
          });
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error("Operation failed", {
          operation: operationName,
          duration,
          error: error instanceof Error ? error.message : String(error),
          spanId: span.id,
          ...metadata,
        });
        throw error;
      }
    },
    metadata
  );
}

/**
 * Decorator for timing class methods
 * Automatically measures and logs method execution time
 *
 * @example
 * class ReportService {
 *   @Timed("generateReport", 30000)
 *   async generateReport(reportId: string) {
 *     // ... implementation
 *   }
 * }
 */
export function Timed(operationName?: string, slowThreshold?: number) {
  return (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    const name = operationName || `${(target as { constructor: { name: string } }).constructor.name}.${propertyKey}`;
    const threshold = slowThreshold || SLOW_OPERATION_THRESHOLD;

    descriptor.value = async function (...args: unknown[]) {
      const startTime = Date.now();

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;

        if (duration > threshold) {
          logger.warn("Slow method execution", {
            method: name,
            duration,
            threshold,
            class: target.constructor.name,
          });
        } else {
          logger.debug("Method executed", {
            method: name,
            duration,
            class: target.constructor.name,
          });
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error("Method execution failed", {
          method: name,
          duration,
          error: error instanceof Error ? error.message : String(error),
          class: target.constructor.name,
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Simple timer for manual timing
 * Use when you need more control over when to start/stop timing
 *
 * @example
 * const timer = createTimer();
 * // ... do work
 * const duration = timer.stop();
 * console.log(`Took ${duration}ms`);
 */
export function createTimer() {
  const startTime = Date.now();

  return {
    /**
     * Get elapsed time without stopping the timer
     */
    elapsed(): number {
      return Date.now() - startTime;
    },

    /**
     * Stop the timer and return duration
     */
    stop(): number {
      return Date.now() - startTime;
    },

    /**
     * Stop and log the duration
     */
    stopAndLog(operationName: string, metadata?: Record<string, unknown>): number {
      const duration = this.stop();

      if (duration > SLOW_OPERATION_THRESHOLD) {
        logger.warn("Slow operation", {
          operation: operationName,
          duration,
          ...metadata,
        });
      } else {
        logger.debug("Operation completed", {
          operation: operationName,
          duration,
          ...metadata,
        });
      }

      return duration;
    },
  };
}

/**
 * Performance metrics aggregator
 * Collects performance metrics in memory for analysis
 */
class PerformanceMetrics {
  private static instance: PerformanceMetrics;
  private metrics = new Map<string, number[]>();

  static getInstance(): PerformanceMetrics {
    if (!PerformanceMetrics.instance) {
      PerformanceMetrics.instance = new PerformanceMetrics();
    }
    return PerformanceMetrics.instance;
  }

  /**
   * Record a metric
   */
  record(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)?.push(value);

    // Keep only last 1000 measurements to avoid memory issues
    const values = this.metrics.get(name)!;
    if (values.length > 1000) {
      values.shift();
    }
  }

  /**
   * Get statistics for a metric
   */
  getStats(name: string): {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) {
      return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;

    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / count,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    };
  }

  /**
   * Get all metrics
   */
  getAllStats(): Record<string, ReturnType<typeof this.getStats>> {
    const stats: Record<string, ReturnType<typeof this.getStats>> = {};
    for (const name of this.metrics.keys()) {
      stats[name] = this.getStats(name);
    }
    return stats;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }
}

/**
 * Export singleton instance
 */
export const performanceMetrics = PerformanceMetrics.getInstance();

/**
 * Measure async operation and record metric
 */
export async function measure<T>(
  metricName: string,
  fn: () => Promise<T>
): Promise<T> {
  const timer = createTimer();
  try {
    const result = await fn();
    performanceMetrics.record(metricName, timer.stop());
    return result;
  } catch (error) {
    performanceMetrics.record(`${metricName}.error`, timer.stop());
    throw error;
  }
}
