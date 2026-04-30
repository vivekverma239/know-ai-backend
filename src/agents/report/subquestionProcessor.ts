import { MODELS } from "@/@types/llm";
import { createContextLogger } from "@/utils/logger";
import type { LanguageModelUsage } from "ai";
import { COMMON_CITATION_PROMPT } from "../common";
import { fileAnswerChunkSearchAgent } from "../tools/fileAnswerChunkSearch";
import { fileAnswerAgent } from "../tools/fileAnswerTableOfContent";
import type { SubQuestionsIdentificationOutput } from "./structuredReport";
import { mergeTokenUsage } from "./utils";

/**
 * Process a single sub-question and return the answer using fileAnswerAgent (TOC-based)
 */
export const processIndividualSubQuestion = async ({
  taskDescription,
  subQuestion,
  topic,
  referencePeriod,
  userId,
  orgId,
  model = MODELS.GROK_4_1_FAST,
}: {
  taskDescription: string;
  subQuestion: SubQuestionsIdentificationOutput["subQuestions"][0];
  topic: string;
  referencePeriod: string;
  userId: string;
  orgId: string;
  model?: MODELS;
}): Promise<{
  question: string;
  documentsIds: string[];
  answer: string;
  usage: Record<string, LanguageModelUsage>;
  error?: string;
}> => {
  const agentLogger = createContextLogger({
    agent: "subQuestionProcessor",
    phase: "processIndividualSubQuestion",
    question: subQuestion.question.substring(0, 80),
  });

  agentLogger.info("💡 Processing sub-question (file agent method)", {
    question: subQuestion.question,
    documentIds: subQuestion.documentsIds,
    documentCount: subQuestion.documentsIds.length,
    model,
  });

  // Build the query with context
  const query = `You are part of a multi-step process to generate a complete report related to a topic.
The task description below provides a quick overview/description of what the full task/final report is.
Your job is to find the answer related to the presented Question using the documents provided.
Your answer, together with many others, will be used in the creation of the report described in the task description on the given topic.
A reference period might also be given to you, for example the reference period for the financial analysis of a company, or the reference period for an economic analysis of a country. The reference period might be missing if it's not a relevant input for the task. The reference period is only a reference for you if needed, but any period mentioned in the Question takes precedence.

Task description: ${taskDescription}

Topic: ${topic}
Reference Period: ${referencePeriod}
Current Date: ${new Date().toISOString().split("T")[0]}

Question: ${subQuestion.question}

Important Guidelines:
- DO NOT make assumptions or include information not present in the documents.
- DO NOT USE YOUR OWN KNOWLEDGE, ONLY USE THE INFORMATION FROM THE PROVIDED DOCUMENTS.

${COMMON_CITATION_PROMPT}`;

  // Clean file IDs (remove 'file_' prefix if present)
  const cleanFileIds = subQuestion.documentsIds.map((id) => id.replace("file_", ""));

  // Track usage
  const globalUsage: Record<string, LanguageModelUsage> = {};
  const addUsage = (usage: { usage: LanguageModelUsage; model: string }) => {
    mergeTokenUsage(globalUsage, usage.model, usage.usage);
  };

  try {
    const result = await fileAnswerAgent({
      query,
      fileIds: cleanFileIds,
      userId,
      orgId,
      model,
      maxIterations: 20,
      addUsage,
    });

    if (result.isErr()) {
      agentLogger.error("❌ Error processing sub-question", {
        error: result.error,
        question: subQuestion.question,
      });

      return {
        question: subQuestion.question,
        documentsIds: subQuestion.documentsIds,
        answer: `Error: ${result.error}`,
        usage: globalUsage,
        error: result.error,
      };
    }

    agentLogger.info("✅ Sub-question answered", {
      answerLength: result.value.answer.length,
      answerPreview: result.value.answer.substring(0, 200),
      filesProcessed: result.value.filesProcessed,
    });

    agentLogger.debug("📊 Sub-question usage", {
      usage: result.value.usage,
    });

    return {
      question: subQuestion.question,
      documentsIds: subQuestion.documentsIds,
      answer: result.value.answer,
      usage: result.value.usage,
    };
  } catch (error) {
    agentLogger.error("❌ Error processing sub-question", {
      error: error instanceof Error ? error.message : String(error),
      question: subQuestion.question,
    });

    return {
      question: subQuestion.question,
      documentsIds: subQuestion.documentsIds,
      answer: "Error processing sub question",
      usage: globalUsage,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

/**
 * Process a single sub-question and return the answer using fileAnswerChunkSearchAgent
 */
export const processIndividualSubQuestionWithChunkSearch = async ({
  taskDescription,
  subQuestion,
  topic,
  referencePeriod,
  userId,
  orgId,
  model = MODELS.GROK_4_1_FAST,
}: {
  taskDescription: string;
  subQuestion: SubQuestionsIdentificationOutput["subQuestions"][0];
  topic: string;
  referencePeriod: string;
  userId: string;
  orgId: string;
  model?: MODELS;
}): Promise<{
  question: string;
  documentsIds: string[];
  answer: string;
  usage: Record<string, LanguageModelUsage>;
  error?: string;
}> => {
  const agentLogger = createContextLogger({
    agent: "subQuestionProcessor",
    phase: "processIndividualSubQuestionWithChunkSearch",
    question: subQuestion.question.substring(0, 80),
  });

  agentLogger.info("💡 Processing sub-question (chunk search method)", {
    question: subQuestion.question,
    documentIds: subQuestion.documentsIds,
    documentCount: subQuestion.documentsIds.length,
    model,
  });

  // Build the query with context
  const query = `You are part of a multi-step process to generate a complete report related to a topic.
The task description below provides a quick overview/description of what the full task/final report is.
Your job is to find the answer related to the presented Question using the documents provided.
Your answer, together with many others, will be used in the creation of the report described in the task description on the given topic.
A reference period might also be given to you, for example the reference period for the financial analysis of a company, or the reference period for an economic analysis of a country. The reference period might be missing if it's not a relevant input for the task. The reference period is only a reference for you if needed, but any period mentioned in the Question takes precedence.

Task description: ${taskDescription}

Topic: ${topic}
Reference Period: ${referencePeriod}
Current Date: ${new Date().toISOString().split("T")[0]}

Question: ${subQuestion.question}

Important Guidelines:
- DO NOT make assumptions or include information not present in the documents.
- DO NOT USE YOUR OWN KNOWLEDGE, ONLY USE THE INFORMATION FROM THE PROVIDED DOCUMENTS.

${COMMON_CITATION_PROMPT}`;

  // Clean file IDs (remove 'file_' prefix if present)
  const cleanFileIds = subQuestion.documentsIds.map((id) => id.replace("file_", ""));

  // Track usage
  const globalUsage: Record<string, LanguageModelUsage> = {};
  const addUsage = (usage: { usage: LanguageModelUsage; model: string }) => {
    mergeTokenUsage(globalUsage, usage.model, usage.usage);
  };

  try {
    const result = await fileAnswerChunkSearchAgent({
      query,
      fileIds: cleanFileIds,
      userId,
      orgId,
      model,
      maxIterations: 20,
      addUsage,
    });

    if (result.isErr()) {
      agentLogger.error("❌ Error processing sub-question with chunk search", {
        error: result.error,
        question: subQuestion.question,
      });

      return {
        question: subQuestion.question,
        documentsIds: subQuestion.documentsIds,
        answer: `Error: ${result.error}`,
        usage: globalUsage,
        error: result.error,
      };
    }

    agentLogger.info("✅ Sub-question answered with chunk search", {
      answerLength: result.value.answer.length,
      answerPreview: result.value.answer.substring(0, 200),
      chunksSearched: result.value.chunksSearched,
      iterations: result.value.iterations,
    });

    agentLogger.debug("📊 Sub-question usage (chunk search)", {
      usage: result.value.usage,
    });

    return {
      question: subQuestion.question,
      documentsIds: subQuestion.documentsIds,
      answer: result.value.answer,
      usage: result.value.usage,
    };
  } catch (error) {
    agentLogger.error("❌ Error processing sub-question with chunk search", {
      error: error instanceof Error ? error.message : String(error),
      question: subQuestion.question,
    });

    return {
      question: subQuestion.question,
      documentsIds: subQuestion.documentsIds,
      answer: "Error processing sub question",
      usage: globalUsage,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};
