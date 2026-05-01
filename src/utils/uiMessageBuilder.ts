import type { StepMessage } from "@/@types/agents";
import { parseCitations, type ParsedCitation } from "@/utils/citation";
import type {
  ReasoningUIPart,
  SourceUrlUIPart,
  TextUIPart,
  UIMessage,
  UIMessagePart,
  UIMessageStreamWriter,
} from "ai";
import { v4 as uuidv4 } from "uuid";

export type ChatMessageMetadata = {
  agent?: "deepResearch" | "knowledgeBase" | "finAgent";
  steps?: StepMessage[];
  sources?: ParsedCitation[];
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  [key: string]: unknown;
};

export type ChatDataParts = {
  step: StepMessage;
};

export type KnowsisUIMessage = UIMessage<ChatMessageMetadata, ChatDataParts>;

type AssistantPart = UIMessagePart<ChatDataParts, Record<string, never>>;

type ToolPart = Extract<AssistantPart, { type: `tool-${string}` }>;
type DataStepPart = Extract<AssistantPart, { type: "data-step" }>;

type BuilderEvent =
  | { type: "mutation" }
  | { type: "step-finished" }
  | { type: "finished" };

type Priority = "milestone" | "delta";

export type UIMessageBuilderOptions = {
  writer: UIMessageStreamWriter<KnowsisUIMessage>;
  messageId?: string;
  initialMetadata?: ChatMessageMetadata;
  /**
   * Seed the builder with an existing partial assistant message. Use this when
   * resuming after a crash: the builder reuses the same id, parts, and metadata,
   * and `start()` is a no-op because the client received the original `start`
   * chunk on the previous (interrupted) stream.
   *
   * Pass the loaded `KnowsisUIMessage` directly. Subsequent mutators append to
   * its `parts`.
   */
  existingAssistant?: KnowsisUIMessage;
  /**
   * Fired after a state mutation. Use this to persist `snapshot()` so a crash
   * leaves you with the latest coherent UIMessage.
   *
   * Token-rate `appendText` / `appendReasoning` mutations are coalesced when
   * `flushIntervalMs` is set; structural mutations (start/end of blocks, tool
   * transitions, step boundaries, finish) always flush immediately.
   */
  onChange?: (snapshot: KnowsisUIMessage, event: BuilderEvent) => void | Promise<void>;
  /**
   * Coalesce delta-priority `onChange` calls inside this window (ms).
   * `0` (default) flushes synchronously on every mutation — fine for chat-sized
   * payloads but wasteful at token streaming rates. A reasonable streaming
   * value is 250-500ms.
   */
  flushIntervalMs?: number;
};

/**
 * Server-side accumulator for a single in-flight assistant `UIMessage`.
 *
 * Every mutator method does two things:
 *   1. mutates an in-memory `KnowsisUIMessage` (the persistable snapshot)
 *   2. emits the matching wire chunk via the supplied writer (the client view)
 *
 * The two views never diverge, so persisting the snapshot after every step
 * gives you the same JSON the client is currently rendering.
 */
export class UIMessageBuilder {
  private readonly writer: UIMessageStreamWriter<KnowsisUIMessage>;
  private readonly onChange?: UIMessageBuilderOptions["onChange"];
  private readonly flushIntervalMs: number;
  private readonly assistant: KnowsisUIMessage;
  private started = false;
  private finished = false;
  private pendingFlush?: NodeJS.Timeout;
  private pendingEvent?: BuilderEvent;

  constructor(opts: UIMessageBuilderOptions) {
    this.writer = opts.writer;
    this.onChange = opts.onChange;
    this.flushIntervalMs = opts.flushIntervalMs ?? 0;
    if (opts.existingAssistant) {
      this.assistant = {
        id: opts.existingAssistant.id,
        role: "assistant",
        parts: structuredClone(opts.existingAssistant.parts),
        metadata: opts.existingAssistant.metadata
          ? structuredClone(opts.existingAssistant.metadata)
          : {},
      };
      // Mark as started so `start()` is a no-op on resume (client already saw it).
      this.started = true;
    } else {
      this.assistant = {
        id: opts.messageId ?? uuidv4(),
        role: "assistant",
        parts: [],
        metadata: opts.initialMetadata ? { ...opts.initialMetadata } : {},
      };
    }
  }

  get id(): string {
    return this.assistant.id;
  }

  /** Deep-cloned snapshot safe to hand to a persistence layer. */
  snapshot(): KnowsisUIMessage {
    return {
      id: this.assistant.id,
      role: this.assistant.role,
      metadata: this.assistant.metadata
        ? structuredClone(this.assistant.metadata)
        : undefined,
      parts: structuredClone(this.assistant.parts),
    };
  }

  // ---------- lifecycle ----------

  start(): void {
    if (this.started) return;
    this.started = true;
    this.writer.write({
      type: "start",
      messageId: this.assistant.id,
      messageMetadata: this.assistant.metadata,
    });
    this.notify({ type: "mutation" }, "milestone");
  }

  startStep(): void {
    this.assistant.parts.push({ type: "step-start" });
    this.writer.write({ type: "start-step" });
    this.notify({ type: "mutation" }, "milestone");
  }

  finishStep(): void {
    this.writer.write({ type: "finish-step" });
    this.notify({ type: "step-finished" }, "milestone");
  }

  finish(opts?: { finishReason?: string; metadata?: Partial<ChatMessageMetadata> }): void {
    if (this.finished) return;
    this.finished = true;
    if (opts?.metadata) this.mergeMetadata(opts.metadata, { emit: false });
    if (opts?.finishReason) {
      this.assistant.metadata = {
        ...(this.assistant.metadata ?? {}),
        finishReason: opts.finishReason,
      };
    }
    this.writer.write({
      type: "finish",
      finishReason: opts?.finishReason as never,
      messageMetadata: this.assistant.metadata,
    });
    this.notify({ type: "finished" }, "milestone");
  }

  // ---------- text ----------

  startText(blockId: string): void {
    this.assistant.parts.push({ type: "text", text: "", state: "streaming" } satisfies TextUIPart);
    this.writer.write({ type: "text-start", id: blockId });
    this.notify({ type: "mutation" }, "milestone");
  }

  appendText(blockId: string, delta: string): void {
    const part = this.lastStreamingTextPart();
    if (part) part.text += delta;
    this.writer.write({ type: "text-delta", id: blockId, delta });
    this.notify({ type: "mutation" }, "delta");
  }

  endText(blockId: string): void {
    const part = this.lastStreamingTextPart();
    if (part) part.state = "done";
    this.writer.write({ type: "text-end", id: blockId });
    this.notify({ type: "mutation" }, "milestone");
  }

  // ---------- reasoning ----------

  startReasoning(blockId: string): void {
    this.assistant.parts.push({
      type: "reasoning",
      text: "",
      state: "streaming",
    } satisfies ReasoningUIPart);
    this.writer.write({ type: "reasoning-start", id: blockId });
    this.notify({ type: "mutation" }, "milestone");
  }

  appendReasoning(blockId: string, delta: string): void {
    const part = this.lastStreamingReasoningPart();
    if (part) part.text += delta;
    this.writer.write({ type: "reasoning-delta", id: blockId, delta });
    this.notify({ type: "mutation" }, "delta");
  }

  endReasoning(blockId: string): void {
    const part = this.lastStreamingReasoningPart();
    if (part) part.state = "done";
    this.writer.write({ type: "reasoning-end", id: blockId });
    this.notify({ type: "mutation" }, "milestone");
  }

  // ---------- tool calls ----------

  startToolCall(args: { toolCallId: string; toolName: string }): void {
    this.assistant.parts.push({
      type: `tool-${args.toolName}`,
      toolCallId: args.toolCallId,
      state: "input-streaming",
      input: undefined,
    } as unknown as ToolPart);
    this.writer.write({
      type: "tool-input-start",
      toolCallId: args.toolCallId,
      toolName: args.toolName,
    });
    this.notify({ type: "mutation" }, "milestone");
  }

  setToolInput(args: { toolCallId: string; toolName: string; input: unknown }): void {
    const part = this.findToolPart(args.toolCallId);
    if (part) {
      Object.assign(part, { state: "input-available", input: args.input });
    }
    this.writer.write({
      type: "tool-input-available",
      toolCallId: args.toolCallId,
      toolName: args.toolName,
      input: args.input,
    });
    this.notify({ type: "mutation" }, "milestone");
  }

  setToolOutput(args: { toolCallId: string; output: unknown }): void {
    const part = this.findToolPart(args.toolCallId);
    if (part) {
      Object.assign(part, { state: "output-available", output: args.output });
    }
    this.writer.write({
      type: "tool-output-available",
      toolCallId: args.toolCallId,
      output: args.output,
    });
    this.notify({ type: "mutation" }, "milestone");
  }

  setToolError(args: { toolCallId: string; errorText: string }): void {
    const part = this.findToolPart(args.toolCallId);
    if (part) {
      Object.assign(part, { state: "output-error", errorText: args.errorText });
    }
    this.writer.write({
      type: "tool-output-error",
      toolCallId: args.toolCallId,
      errorText: args.errorText,
    });
    this.notify({ type: "mutation" }, "milestone");
  }

  // ---------- custom data parts (deepResearch step events) ----------

  /**
   * Upserts a `data-step` part by id. Mirrors the existing `writer.write({ type: "data-step", ... })`
   * flow but also keeps the part inside `assistant.parts` so a reload renders it.
   */
  upsertStep(step: StepMessage): void {
    const part: DataStepPart = { type: "data-step", id: step.id, data: step };
    const existing = this.assistant.parts.findIndex(
      (p) => p.type === "data-step" && (p as DataStepPart).id === step.id,
    );
    if (existing >= 0) this.assistant.parts[existing] = part;
    else this.assistant.parts.push(part);

    this.writer.write({ type: "data-step", id: step.id, data: step });
    this.notify({ type: "mutation" }, "milestone");
  }

  // ---------- sources ----------

  addSourceUrl(args: { sourceId: string; url: string; title?: string }): void {
    const part: SourceUrlUIPart = {
      type: "source-url",
      sourceId: args.sourceId,
      url: args.url,
      title: args.title,
    };
    this.assistant.parts.push(part);
    this.writer.write({
      type: "source-url",
      sourceId: args.sourceId,
      url: args.url,
      title: args.title,
    });
    this.notify({ type: "mutation" }, "milestone");
  }

  // ---------- metadata ----------

  mergeMetadata(patch: Partial<ChatMessageMetadata>, opts: { emit?: boolean } = {}): void {
    this.assistant.metadata = { ...(this.assistant.metadata ?? {}), ...patch };
    if (opts.emit !== false) {
      this.writer.write({
        type: "message-metadata",
        messageMetadata: patch as ChatMessageMetadata,
      });
    }
    this.notify({ type: "mutation" }, "milestone");
  }

  /**
   * Re-parse citations from the joined text of the message and stream the
   * updated `metadata.sources` to the client. Call after `endText` on each
   * step so partial citations show up incrementally.
   */
  async refreshCitations(): Promise<void> {
    const text = this.assistant.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n");
    if (!text) return;
    const sources = await parseCitations(text);
    this.mergeMetadata({ sources });
  }

  /**
   * Force any pending debounced `onChange` to fire now. Awaits the persistence
   * call before resolving — call this at the end of the loop or before
   * `finish()` when you need a guarantee that the latest snapshot is on disk.
   */
  async flush(): Promise<void> {
    if (!this.pendingFlush) return;
    const event = this.pendingEvent ?? { type: "mutation" };
    clearTimeout(this.pendingFlush);
    this.pendingFlush = undefined;
    this.pendingEvent = undefined;
    await this.runOnChange(event);
  }

  // ---------- internals ----------

  private notify(event: BuilderEvent, priority: Priority): void {
    if (!this.onChange) return;
    if (priority === "milestone" || this.flushIntervalMs <= 0) {
      this.flushNow(event);
      return;
    }
    this.pendingEvent = event;
    if (!this.pendingFlush) {
      this.pendingFlush = setTimeout(() => {
        const e = this.pendingEvent ?? { type: "mutation" };
        this.pendingFlush = undefined;
        this.pendingEvent = undefined;
        this.flushNow(e);
      }, this.flushIntervalMs);
    }
  }

  private flushNow(event: BuilderEvent): void {
    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush);
      this.pendingFlush = undefined;
      this.pendingEvent = undefined;
    }
    void this.runOnChange(event);
  }

  private async runOnChange(event: BuilderEvent): Promise<void> {
    if (!this.onChange) return;
    try {
      await this.onChange(this.snapshot(), event);
    } catch {
      // Persistence failures must not break the stream. Caller logs.
    }
  }

  private lastStreamingTextPart(): TextUIPart | undefined {
    for (let i = this.assistant.parts.length - 1; i >= 0; i--) {
      const p = this.assistant.parts[i];
      if (p.type === "text") return p as TextUIPart;
    }
    return undefined;
  }

  private lastStreamingReasoningPart(): ReasoningUIPart | undefined {
    for (let i = this.assistant.parts.length - 1; i >= 0; i--) {
      const p = this.assistant.parts[i];
      if (p.type === "reasoning") return p as ReasoningUIPart;
    }
    return undefined;
  }

  private findToolPart(toolCallId: string): ToolPart | undefined {
    return this.assistant.parts.find(
      (p): p is ToolPart =>
        typeof p.type === "string" &&
        p.type.startsWith("tool-") &&
        (p as ToolPart).toolCallId === toolCallId,
    );
  }
}
