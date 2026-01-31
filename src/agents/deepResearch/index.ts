import { z } from "zod";
import { generateObject } from "ai";
import { DEFAULT_SMALL_MODEL } from "@/ai-backend/llm";
import { getLLM } from "@/ai-backend/llm";
import type { SimilarChunk } from "@/db/queries/simChunks";
import { similaritySearchChunks } from "@/service/simSearch";
import { StepType, type StepMessage } from "@/@types/agents";
import { logger } from "@/utils/logger";
import { v4 as uuidv4 } from "uuid";
import { observe } from "@lmnr-ai/lmnr";
import { chapterAgentV3 } from "../fileAgent/chapter";

export const chunkSearch = async ({
  query,
  documents,
  userId,
  orgId,
  callback,
}: {
  query: string;
  documents: { id: string; title: string }[];
  userId: string;
  orgId: string;
  callback?: (step: StepMessage) => void;
}) => {
  const llm = getLLM(DEFAULT_SMALL_MODEL);
  const response = await generateObject({
    model: llm,
    prompt: `
    You are an expert fiancial analyst. Your job is given the query and list
    of documents, mention what information to extract from the documents.
    Query: {query}
    Documents: {documents}
    `
      .replace("{query}", query)
      .replace("{documents}", JSON.stringify(documents)),
    temperature: 2,
    schema: z.object({
      documents: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          queries: z
            .array(z.string())
            .describe("List of things to extract from the document"),
        })
      ),
    }),
    experimental_telemetry: {
      isEnabled: true,
    },
  });
  const res = response.object;

  // For each response identify chunks
  const chunkPromises: Promise<SimilarChunk[]>[] = [];
  for (const document of res.documents) {
    for (const query of document.queries) {
      chunkPromises.push(
        similaritySearchChunks({
          query,
          documentIds: [document.id],
          limit: 5,
          includeChunkId: true,
          page: 1,
          userId,
          orgId,
        })
      );
    }
  }
  const chunks = await Promise.all(chunkPromises);
  const sortedChunks = chunks
    .flat()
    .sort((a, b) => b.similarity - a.similarity);
  callback?.({
    id: uuidv4(),
    type: StepType.CHUNK_SEARCH,
    status: "done",
    message: `Chunks fetched: ${sortedChunks.length}`,
    metadata: {
      chunks: sortedChunks.slice(0, 10).map((c) => ({
        document: documents.find((d) => d.id === c.documentId)?.title,
        content: `${c.content.slice(0, 100)}...`,
      })),
    },
  });
  return sortedChunks.slice(0, 10).map((c) => ({
    documentId: c.documentId,
    content: c.content,
  })) as SimilarChunk[];
};

export const processDeepSearchQuery = async ({
  query,
  userId,
  orgId,
  callback,
}: {
  query: string;
  userId: string;
  orgId: string;
  callback?: (step: StepMessage) => void;
}) => {
  const queryExpansionStep: StepMessage = {
    id: uuidv4(),
    type: StepType.QUERY_EXPANSION,
    status: "done",
    message: "Query passed to deep search agent",
    metadata: {
      query: query,
    },
  };
  callback?.(queryExpansionStep);

  logger.info("Running chapter agent");

  const responseCall = () =>
    observe(
      { name: "chapterAgentV3" },
      async (query: string, userId: string, orgId: string) =>
        await chapterAgentV3({ query, userId, orgId, callback }),
      query,
      userId,
      orgId
    );
  const response = await responseCall();

  // log final response
  const finalResponseStep: StepMessage = {
    id: uuidv4(),
    type: StepType.RESPOND,
    status: "done",
    message: "Final response",
    metadata: {
      response: response,
    },
  };
  callback?.(finalResponseStep);

  return {
    response: response,
  };
};
