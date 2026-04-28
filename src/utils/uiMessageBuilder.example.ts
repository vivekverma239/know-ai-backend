/**
 * Sketch only. Not wired into any route. Demonstrates the manual-loop +
 * UIMessageBuilder pattern against the existing chatStream.routes.ts shape.
 *
 *   - one in-flight assistant `KnowsisUIMessage` is owned by the builder
 *   - every wire chunk emitted by the builder also mutates that snapshot
 *   - `onChange` persists the snapshot to the DB after every mutation
 *   - on crash, the DB has the latest coherent UIMessage; on reload the
 *     frontend renders exactly what was on screen pre-crash
 *   - `agent.continue()`-style resume is a follow-up: load the snapshot,
 *     check whether the last persisted state needs another LLM turn
 *     (e.g. tool with `output-available` but no follow-up text), and
 *     re-enter the loop without inserting a new user prompt.
 */

import { processDeepSearchQuery } from "@/agents/deepResearch";
import { getLLM } from "@/ai-backend/llm";
import { MODELS } from "@/@types/llm";
import { generateText, convertToModelMessages, createUIMessageStream } from "ai";
import { z } from "zod";
import {
  type KnowsisUIMessage,
  UIMessageBuilder,
} from "@/utils/uiMessageBuilder";

type DeepSearchLoopArgs = {
  history: KnowsisUIMessage[];
  userId: string;
  orgId: string;
  systemPrompt: string;
  /** Persist the current assistant snapshot. Called on every mutation. */
  saveAssistantSnapshot: (msg: KnowsisUIMessage) => Promise<void>;
};

export const buildDeepSearchStream = (args: DeepSearchLoopArgs) =>
  createUIMessageStream<KnowsisUIMessage>({
    execute: async ({ writer }) => {
      const builder = new UIMessageBuilder({
        writer,
        initialMetadata: { agent: "deepResearch", steps: [] },
        onChange: async (snapshot) => {
          await args.saveAssistantSnapshot(snapshot);
        },
      });

      builder.start();

      const tools = {
        deepSearchTool: {
          description: "Comprehensive deep search over user docs.",
          inputSchema: z.object({ query: z.string() }),
          execute: async ({ query }: { query: string }, opts: { toolCallId: string }) => {
            return processDeepSearchQuery({
              query,
              userId: args.userId,
              orgId: args.orgId,
              callback: (step) => {
                // Same shape as today's writer.write({ type: "data-step", ... }),
                // but now the step is also inside builder.snapshot().parts so a
                // reload after a crash mid-search shows the partial progress.
                builder.upsertStep(step);
              },
            }).then((result) => {
              // Optional: surface tool result on the wire and in the snapshot.
              builder.setToolOutput({ toolCallId: opts.toolCallId, output: result });
              return result;
            });
          },
        },
      };

      const messagesIn = await convertToModelMessages(args.history);
      const llm = getLLM(MODELS.GEMINI_3_FLASH);

      // Manual loop: run generateText repeatedly until the model produces a
      // text response (no further tool calls). Each step is a persistence
      // checkpoint via builder mutations + onChange.
      const maxSteps = 50;
      for (let step = 0; step < maxSteps; step++) {
        builder.startStep();

        const result = await generateText({
          model: llm,
          system: args.systemPrompt,
          messages: messagesIn,
          tools,
        });

        // Walk the step messages, mirroring text/tool-call/tool-result into the
        // builder. Token-level streaming would use streamText + onChunk instead;
        // generateText keeps the example readable.
        for (const m of result.response.messages) {
          for (const c of Array.isArray(m.content) ? m.content : []) {
            if (c.type === "text") {
              const blockId = `t-${step}-${builder.id}`;
              builder.startText(blockId);
              builder.appendText(blockId, c.text);
              builder.endText(blockId);
            }
            if (c.type === "tool-call") {
              builder.startToolCall({ toolCallId: c.toolCallId, toolName: c.toolName });
              builder.setToolInput({
                toolCallId: c.toolCallId,
                toolName: c.toolName,
                input: c.input,
              });
            }
            // tool-result content is handled inside the tool's execute() above
            // via builder.setToolOutput, so it doesn't need a branch here.
          }
        }

        // Refresh citations after every step that produced text.
        await builder.refreshCitations();

        // Feed this step's assistant + tool-result messages back for the next turn.
        messagesIn.push(...result.response.messages);

        builder.finishStep();

        if (result.finishReason !== "tool-calls") break;
      }

      builder.finish({ finishReason: "stop" });
    },
  });
