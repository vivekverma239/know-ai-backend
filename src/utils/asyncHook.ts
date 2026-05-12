import { AsyncLocalStorage } from "node:async_hooks";
import { logError, logger } from "@/utils/logger";
import { v4 as uuidv4 } from "uuid";

// Types for token tracking
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  timestamp: Date;
  operationId: string;
  operationName: string;
  parentOperationId?: string;
}

export interface TokenTrackingContext {
  operationId: string;
  operationName: string;
  tokenUsage: TokenUsage[];
  startTime: Date;
  metadata?: Record<string, unknown>;
}

// Create async storage for token tracking context
const tokenTrackingStorage = new AsyncLocalStorage<TokenTrackingContext>();

// Global token usage aggregator
class TokenUsageAggregator {
  private static instance: TokenUsageAggregator;
  private totalUsage = new Map<string, TokenUsage[]>();

  static getInstance(): TokenUsageAggregator {
    if (!TokenUsageAggregator.instance) {
      TokenUsageAggregator.instance = new TokenUsageAggregator();
    }
    return TokenUsageAggregator.instance;
  }

  addUsage(operationId: string, usage: TokenUsage): void {
    if (!this.totalUsage.has(operationId)) {
      this.totalUsage.set(operationId, []);
    }
    this.totalUsage.get(operationId)?.push(usage);
  }

  getUsage(operationId: string): TokenUsage[] {
    return this.totalUsage.get(operationId) ?? [];
  }

  getTotalUsage(operationId: string): TokenUsage {
    const usages = this.getUsage(operationId);
    return usages.reduce(
      (total, usage) => ({
        promptTokens: total.promptTokens + usage.promptTokens,
        completionTokens: total.completionTokens + usage.completionTokens,
        totalTokens: total.totalTokens + usage.totalTokens,
        model: usage.model, // Use the last model as representative
        timestamp: new Date(),
        operationId,
        operationName: usage.operationName,
      }),
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        model: "",
        timestamp: new Date(),
        operationId,
        operationName: "",
      },
    );
  }

  clearUsage(operationId: string): void {
    this.totalUsage.delete(operationId);
  }

  getAllUsage(): Map<string, TokenUsage[]> {
    return new Map(this.totalUsage);
  }
}

// Token tracking hook function
export function withTokenTracking<T>(
  operationName: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const operationId = uuidv4();
  const context: TokenTrackingContext = {
    operationId,
    operationName,
    tokenUsage: [],
    startTime: new Date(),
    metadata,
  };

  return tokenTrackingStorage.run(context, async () => {
    const result = await fn();
    return result;
  });
}

/**
 * Persist token usage to the database.
 *
 * Historically this function inlined the cost calc + tokenUsageLog insert,
 * which made it a second writer that could (and did) diverge from the
 * unified path. It now delegates to recordLlmUsage so every row is shaped
 * and priced identically regardless of whether it was emitted by an agent
 * loop, a `*Wrapper` LLM call, or the legacy withTokenTracking path.
 *
 * Kept async + fire-and-forget for backwards compatibility with callers
 * that schedule it via setImmediate.
 */
async function persistTokenUsage(usage: TokenUsage): Promise<void> {
  try {
    // Dynamic import keeps the original lazy-load pattern (intended to
    // avoid circular dependencies during server bootstrap).
    const { recordLlmUsage } = await import("./costTracker.js");
    await recordLlmUsage({
      operationName: usage.operationName,
      operationId: usage.operationId,
      parentOperationId: usage.parentOperationId,
      model: usage.model,
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      source: "tool",
    });
  } catch (error) {
    logError(error, {
      operationId: usage.operationId,
      operation: "persistTokenUsage",
      message: "Failed to delegate token usage to recordLlmUsage",
    });
  }
}

// Function to record token usage for a specific LLM call
export function recordTokenUsage(
  usage: Omit<TokenUsage, "operationId" | "operationName" | "timestamp">,
): void {
  const context = tokenTrackingStorage.getStore();
  if (!context) {
    logger.warn("No token tracking context found. Make sure to use withTokenTracking.");
    return;
  }

  const fullUsage: TokenUsage = {
    ...usage,
    operationId: context.operationId,
    operationName: context.operationName,
    timestamp: new Date(),
  };

  // Add to context
  context.tokenUsage.push(fullUsage);

  // Add to global aggregator
  TokenUsageAggregator.getInstance().addUsage(context.operationId, fullUsage);

  // Log the usage
  logger.debug(`Token usage recorded for ${context.operationName}`, {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    model: usage.model,
    operationId: context.operationId,
  });

  // Persist to database asynchronously (don't block on this)
  if (process.env.PERSIST_TOKEN_USAGE !== "false") {
    persistTokenUsage(fullUsage).catch((error) => {
      // Error already logged in persistTokenUsage, but log again at top level if needed
      logger.debug("Token usage persistence failed (non-blocking)", {
        operationId: fullUsage.operationId,
      });
    });
  }
}

// Function to get current operation context
export function getCurrentTokenContext(): TokenTrackingContext | undefined {
  return tokenTrackingStorage.getStore();
}

// Function to get token usage for current operation
export function getCurrentTokenUsage(): TokenUsage[] {
  const context = tokenTrackingStorage.getStore();
  return context?.tokenUsage ?? [];
}

// Function to get total token usage for current operation
export function getCurrentTotalTokenUsage(): TokenUsage | null {
  const context = tokenTrackingStorage.getStore();
  if (!context) return null;

  const usages = context.tokenUsage;
  if (usages.length === 0) return null;

  return usages.reduce(
    (total, usage) => ({
      promptTokens: total.promptTokens + usage.promptTokens,
      completionTokens: total.completionTokens + usage.completionTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
      model: usage.model,
      timestamp: new Date(),
      operationId: context.operationId,
      operationName: context.operationName,
    }),
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model: "",
      timestamp: new Date(),
      operationId: context.operationId,
      operationName: context.operationName,
    },
  );
}

// Function to get token usage by operation ID
export function getTokenUsageByOperationId(operationId: string): TokenUsage[] {
  return TokenUsageAggregator.getInstance().getUsage(operationId);
}

// Function to get total token usage by operation ID
export function getTotalTokenUsageByOperationId(operationId: string): TokenUsage {
  return TokenUsageAggregator.getInstance().getTotalUsage(operationId);
}

// Function to clear token usage for an operation
export function clearTokenUsage(operationId: string): void {
  TokenUsageAggregator.getInstance().clearUsage(operationId);
}

// Function to get all token usage
export function getAllTokenUsage(): Map<string, TokenUsage[]> {
  return TokenUsageAggregator.getInstance().getAllUsage();
}

// Type for AI SDK response with usage information
interface AIResponseWithUsage {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  telemetry?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
    model?: string;
  };
  data?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
    model?: string;
  };
  model?: string;
}

// Higher-order function to wrap AI SDK calls with token tracking
export function withTokenTrackingForAI<T extends (...args: unknown[]) => Promise<unknown>>(
  operationName: string,
  aiFunction: T,
  metadata?: Record<string, unknown>,
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return withTokenTracking(
      operationName,
      async () => {
        const result = await aiFunction(...args);

        // Try to extract token usage from AI SDK response
        if (result && typeof result === "object") {
          const usage = extractTokenUsageFromAIResponse(result as AIResponseWithUsage);
          if (usage) {
            recordTokenUsage(usage);
          }
        }

        return result as ReturnType<T>;
      },
      metadata,
    );
  }) as T;
}

// Function to extract token usage from AI SDK response
function extractTokenUsageFromAIResponse(
  response: AIResponseWithUsage,
): Omit<TokenUsage, "operationId" | "operationName" | "timestamp"> | null {
  const getPromptTokens = (usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): { promptTokens: number; completionTokens: number; totalTokens: number } => {
    const promptTokens = usage?.inputTokens ?? 0;
    const completionTokens = usage?.outputTokens ?? 0;
    const totalTokens = usage?.totalTokens ?? promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  };

  // Check for common AI SDK response patterns
  if (response?.usage) {
    const { promptTokens, completionTokens, totalTokens } = getPromptTokens(response.usage);
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      model: response.model ?? "unknown",
    };
  }

  // Check for Braintrust telemetry data
  if (response?.telemetry?.usage) {
    const { promptTokens, completionTokens, totalTokens } = getPromptTokens(
      response.telemetry.usage,
    );
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      model: response.telemetry.model ?? "unknown",
    };
  }

  // Check for other common patterns
  if (response?.data?.usage) {
    const { promptTokens, completionTokens, totalTokens } = getPromptTokens(response.data.usage);
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      model: response.data.model ?? "unknown",
    };
  }

  return null;
}

// Utility function to create a token tracking wrapper for generateText
export function createTokenTrackedGenerateText() {
  return withTokenTrackingForAI("generateText", async (options: unknown) => {
    const { generateText } = await import("ai");
    return generateText(options as Parameters<typeof generateText>[0]);
  });
}

// Utility function to create a token tracking wrapper for generateObject
export function createTokenTrackedGenerateObject() {
  return withTokenTrackingForAI("generateObject", async (options: unknown) => {
    const { generateObject } = await import("ai");
    return generateObject(options as Parameters<typeof generateObject>[0]);
  });
}

// Utility function to create a token tracking wrapper for streamText
export function createTokenTrackedStreamText() {
  return withTokenTrackingForAI("streamText", async (options: unknown) => {
    const { streamText } = await import("ai");
    return streamText(options as Parameters<typeof streamText>[0]);
  });
}

// Function to log token usage summary
export function logTokenUsageSummary(operationId?: string): void {
  if (operationId) {
    const usage = getTotalTokenUsageByOperationId(operationId);
    logger.debug(`Token usage summary for ${operationId}`, { usage });
  } else {
    const context = getCurrentTokenContext();
    if (context) {
      const usage = getCurrentTotalTokenUsage();
      if (usage) {
        logger.debug("Token usage summary for current operation", { usage });
      }
    }
  }
}

// Function to create a token tracking context with custom operation ID
export function withCustomTokenTracking<T>(
  operationId: string,
  operationName: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const context: TokenTrackingContext = {
    operationId,
    operationName,
    tokenUsage: [],
    startTime: new Date(),
    metadata,
  };

  return tokenTrackingStorage.run(context, async () => {
    const result = await fn();
    return result;
  });
}

// Export the main hook function as default
export default withTokenTracking;
