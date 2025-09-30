import { z } from "zod";

export const approachSchema = z.object({
  steps: z.array(
    z.object({
      details: z.string(),
      type: z.enum(["extraction", "analysis"]),
    }),
  ),
});
export type Approach = z.infer<typeof approachSchema>;

export enum StepType {
  ANALYST_SELECTION = "analyst_selection",
  APPROACH_GENERATION = "approach_generation",
  TIP_SEARCH = "tip_search",
  DOCUMENT_FILTER = "document_filter",
  RAG_EXTRACTION = "rag_extraction",
  RESPOND = "respond",
  CHUNK_SEARCH = "chunk_search",
  CHUNK_ANALYSIS_STEP = "chunk_analysis_step",
  CHAPTER_SEARCH = "chapter_search",
  QUERY_EXPANSION = "query_expansion",
}

export type AnalystMeta = {
  name: string;
};

export type ApproachMeta = {
  approach: Approach;
};

export type DocumentMeta = {
  documents: { id: string; title: string }[];
};

export type RespondMeta = {
  response: string;
};

export type StepMessage = {
  id: string;
  type: StepType;
  status: "processing" | "done";
  message?: string;
  metadata?: AnalystMeta | ApproachMeta | DocumentMeta | RespondMeta | object;
};
