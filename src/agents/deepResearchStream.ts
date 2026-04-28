import type { Message as SQLMessage } from "@/@types";
import type { StepMessage } from "@/@types/agents";
import { processDeepSearchQuery } from "@/agents/deepResearch";
import type { getLLM } from "@/ai-backend/llm";
import { syncMessages } from "@/db/queries/message";
import { extractMessageMetadata } from "@/utils/uiMessageMetadata";
import {
  type KnowsisUIMessage,
  UIMessageBuilder,
} from "@/utils/uiMessageBuilder";
import { loadForResume, shouldResumeLoop } from "@/utils/uiMessageResume";
import { getTracer, observe } from "@lmnr-ai/lmnr";
import {
  convertToModelMessages,
  createUIMessageStream,
  stepCountIs,
  streamText,
} from "ai";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

type LLM = ReturnType<typeof getLLM>;

export type DeepResearchStreamArgs = {
  /** UIMessages from the request body (already filtered/persisted upstream). */
  messages: KnowsisUIMessage[];
  sessionId: string;
  userId: string;
  orgId: string;
  systemPrompt: string;
  llm: LLM;
  logger: { error: (message: string, meta?: Record<string, unknown>) => void };
  /** Persists the assistant snapshot. Called from `UIMessageBuilder.onChange`. */
  persistAssistant: (snapshot: KnowsisUIMessage) => Promise<void>;
};

/**
 * Build the UIMessageStream for the deep-research agent branch.
 *
 *   - Detects whether the last persisted assistant message is incomplete and
 *     seeds the builder with it so the loop appends to the same UIMessage.
 *   - Mirrors `streamText`'s `fullStream` chunks into the builder so the wire
 *     output and the persistable snapshot stay byte-identical.
 *   - Emits `data-step` parts for `processDeepSearchQuery` callbacks (lives in
 *     the snapshot, so a crashed session shows its progress on reload).
 */
export const buildDeepResearchStream = async (args: DeepResearchStreamArgs) => {
  const resume = await loadForResume(args.sessionId);
  const isResume = shouldResumeLoop(resume.status);
  const existingAssistant =
    resume.status.kind === "incomplete-text" ||
    resume.status.kind === "incomplete-tool" ||
    resume.status.kind === "tool-finished-no-followup"
      ? resume.status.assistant
      : undefined;

  // History fed to the model. On a resume, the persisted history *already
  // includes* the partial assistant — pass it through `convertToModelMessages`
  // and Vercel's converter normalises any in-flight text/tool parts.
  const history = isResume ? resume.history : args.messages;

  return observe({ name: "deepSearchAgent" }, () =>
    createUIMessageStream<KnowsisUIMessage>({
      originalMessages: history,
      execute: async ({ writer }) => {
        const builder = new UIMessageBuilder({
          writer,
          existingAssistant,
          initialMetadata: { agent: "deepResearch", steps: [] },
          flushIntervalMs: 250,
          onChange: async (snapshot) => {
            try {
              await args.persistAssistant(snapshot);
            } catch (error) {
              args.logger.error("Failed to persist assistant snapshot", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        });

        builder.start();

        const result = streamText({
          model: args.llm,
          system: args.systemPrompt,
          stopWhen: stepCountIs(50),
          messages: [
            { role: "system", content: args.systemPrompt },
            ...(await convertToModelMessages(history)),
          ],
          tools: {
            deepSearchTool: {
              description:
                "Use this tool to do a comprehensive deep search based on user query and return a final report.",
              inputSchema: z.object({
                query: z
                  .string()
                  .describe(
                    "The query to research on, should be fully formulated question with all relevant context",
                  ),
              }),
              execute: async ({ query }: { query: string }) => {
                try {
                  return await processDeepSearchQuery({
                    query,
                    userId: args.userId,
                    orgId: args.orgId,
                    callback: (step: StepMessage) => {
                      builder.upsertStep(step);
                    },
                  });
                } catch (error) {
                  args.logger.error("deepSearchTool failed", {
                    query,
                    error: error instanceof Error ? error.message : String(error),
                  });
                  throw error;
                }
              },
            },
          },
          experimental_telemetry: {
            isEnabled: true,
            tracer: getTracer(),
          },
        });

        // Single-source-of-truth: every wire chunk goes through the builder,
        // which writes it to `writer` AND mutates the persistable snapshot.
        let finishReason: string | undefined;
        for await (const chunk of result.fullStream) {
          const metadataPatch = extractMessageMetadata(chunk);
          if (metadataPatch) builder.mergeMetadata(metadataPatch);
          if (chunk.type === "finish") finishReason = chunk.finishReason;
          switch (chunk.type) {
            case "start-step":
              builder.startStep();
              break;
            case "finish-step":
              builder.finishStep();
              break;
            case "text-start":
              builder.startText(chunk.id);
              break;
            case "text-delta":
              builder.appendText(chunk.id, chunk.text);
              break;
            case "text-end":
              builder.endText(chunk.id);
              break;
            case "reasoning-start":
              builder.startReasoning(chunk.id);
              break;
            case "reasoning-delta":
              builder.appendReasoning(chunk.id, chunk.text);
              break;
            case "reasoning-end":
              builder.endReasoning(chunk.id);
              break;
            case "tool-input-start":
              builder.startToolCall({ toolCallId: chunk.id, toolName: chunk.toolName });
              break;
            case "tool-call":
              builder.setToolInput({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input,
              });
              break;
            case "tool-result":
              builder.setToolOutput({
                toolCallId: chunk.toolCallId,
                output: chunk.output,
              });
              break;
            case "tool-error":
              builder.setToolError({
                toolCallId: chunk.toolCallId,
                errorText:
                  chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
              });
              break;
            case "finish":
              break;
          }
        }

        await builder.refreshCitations();
        await builder.flush();
        builder.finish({ finishReason: finishReason ?? "stop" });
      },
      onError: (error) => {
        args.logger.error("Chat stream execution failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return String(error);
      },
    }),
  );
};

/**
 * Convenience: persist a single `KnowsisUIMessage` to the messages table via
 * the existing `syncMessages` upsert. Used as the `persistAssistant` callback.
 */
export const persistAssistantSnapshot = (args: {
  sessionId: string;
  userId: string;
}) =>
  async (snapshot: KnowsisUIMessage): Promise<void> => {
    const row: SQLMessage = {
      id: snapshot.id || uuidv4(),
      role: snapshot.role,
      metadata: snapshot.metadata ?? null,
      createdAt: new Date(),
      updatedAt: null,
      sessionId: args.sessionId,
      parts: snapshot.parts,
      userId: args.userId,
    } as SQLMessage;
    await syncMessages([row]);
  };

