import { MODELS } from "@/@types/llm";
import { getLLM, getProviderOptions } from "@/ai-backend/llm";
import { getDb } from "@/db";
import { structuredReportTemplate, structuredReports, userFile } from "@/db/schema";
import { parseSources } from "@/service/citations";
import { createContextLogger } from "@/utils/logger";
import { getTracer, observe } from "@lmnr-ai/lmnr";
import { type LanguageModelUsage, generateObject, generateText, stepCountIs } from "ai";
import { eq, inArray } from "drizzle-orm";
import pLimit from "p-limit";
import { z } from "zod";
import { COMMON_CITATION_PROMPT } from "../common";
import { getFileAnswerTool, getFileSearchTool } from "./section";
import {
  processIndividualSubQuestion,
  processIndividualSubQuestionWithChunkSearch,
} from "./subquestionProcessor";
import { mergeTokenUsage } from "./utils";

export const initialResearchOutputSchema = z.object({
  researchOutput: z.string(),
});
export type InitialResearchOutput = z.infer<typeof initialResearchOutputSchema>;

export const subQuestionsIdentificationOutputSchema = z.object({
  subQuestions: z.array(
    z.object({
      question: z.string(),
      documentsIds: z.array(z.string()),
    }),
  ),
});

export type SubQuestionsIdentificationOutput = z.infer<
  typeof subQuestionsIdentificationOutputSchema
>;

export const subQuestionAnswerOutputSchema = z.object({
  subQuestions: z.array(
    z.object({
      question: z.string(),
      documentsIds: z.array(z.string()),
      answer: z.string(),
      error: z.string().optional(),
    }),
  ),
});

export type SubQuestionAnswer = z.infer<typeof subQuestionAnswerOutputSchema>;

export const finalReportOutputSchema = z.object({
  report: z.string(),
});

export type FinalReportOutput = z.infer<typeof finalReportOutputSchema>;

export type StepOutputs = {
  initialResearch: InitialResearchOutput;
  subQuestionsIdentification: SubQuestionsIdentificationOutput;
  subQuestionAnswer: SubQuestionAnswer;
  finalReport: FinalReportOutput;
};

const db = getDb();

// Simple retry helper
async function executeWithRetries<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError;
}

export const processInitialResearch = async ({
  taskDescription,
  initialResearchPrompt,
  topic,
  referencePeriod,
  userId,
  orgId,
  model = MODELS.GROK_4_1_FAST,
}: {
  taskDescription: string;
  initialResearchPrompt: string;
  topic: string;
  referencePeriod: string;
  userId: string;
  orgId: string;
  model?: MODELS;
}): Promise<{
  researchOutput: string;
  usage: Record<string, LanguageModelUsage>;
}> => {
  const logger = createContextLogger({
    agent: "structuredReport",
    phase: "initialResearch",
  });

  const finalPrompt = `
You are part of a multi-step process to generate a complete report related to a topic.
The task description below provides a quick overview/description of what the full task/final report is.
Your job is to perform the initial research and share your findings on the given topic, following the instructions provided (Initial search instructions).

Task description: ${taskDescription}

You must also include the file IDs of the documents you used to perform the initial research.
IMPORTANT:
- DO NOT make assumptions or include information not present in the documents.
- DO NOT USE YOUR OWN KNOWLEDGE, ONLY USE THE INFORMATION FROM THE PROVIDED DOCUMENTS.

${COMMON_CITATION_PROMPT}
 `;

  const usage: Record<string, LanguageModelUsage> = {};
  const llm = getLLM(model);
  const providerOptions = getProviderOptions(model, "default");
  const response = await executeWithRetries(
    async () => {
      return await generateText({
        model: llm,
        messages: [
          { role: "system", content: finalPrompt },
          {
            role: "user",
            content: `Topic: ${topic}\nReference Period: ${referencePeriod}\nCurrent Date: ${new Date().toISOString().split("T")[0]}\nInitial research instructions: ${initialResearchPrompt}`,
          },
        ],
        tools: {
          documentSearch: getFileSearchTool(userId, orgId),
          documentAnswer: getFileAnswerTool(
            (addUsage: { usage: LanguageModelUsage; model: string }) => {
              mergeTokenUsage(usage, addUsage.model, addUsage.usage);
            },
          ),
        },
        providerOptions,
        stopWhen: stepCountIs(50),
        temperature: 1,
        experimental_telemetry: {
          isEnabled: true,
          tracer: getTracer(),
        },
      });
    },
    "generate text for initial research",
    3,
  );

  mergeTokenUsage(usage, model, response.usage);

  return {
    researchOutput: response.text,
    usage: usage,
  };
};

export const processSubQuestionsIdentification = async ({
  taskDescription,
  initialResearchOutput,
  subQuestionsIdentificationPrompt,
  topic,
  referencePeriod,
  model = MODELS.GROK_4_1_FAST,
}: {
  taskDescription: string;
  initialResearchOutput: string;
  subQuestionsIdentificationPrompt: string;
  topic: string;
  referencePeriod: string;
  model?: MODELS;
}): Promise<{
  subQuestions: SubQuestionsIdentificationOutput["subQuestions"];
  usage: Record<string, LanguageModelUsage>;
}> => {
  const llm = getLLM(model);

  const finalPrompt = `
	You are part of a multi-step process to generate a complete report related to a topic.
The task description below provides a quick overview/description of what the full task/final report is.
An initial search to find content to complete the task has already been done, and it will be provided to you (the Initial Research Output).
Your job is to identify the next set of questions that are needed to dig deeper based on the initial findings and/or find relevant details missing from the initial findings, in order to have all the material necessary to prepare the report.

Task description: ${taskDescription}
  `;
  const response = await executeWithRetries(
    async () => {
      return await generateObject({
        model: llm,
        schema: subQuestionsIdentificationOutputSchema,
        messages: [
          { role: "system", content: finalPrompt },
          {
            role: "user",
            content: `
            Topic: ${topic}
            Reference Period: ${referencePeriod}
            Current Date: ${new Date().toISOString().split("T")[0]}
            --------------------------------
            More detailed instructions on how to formulate your questions: 
            ${subQuestionsIdentificationPrompt}
            --------------------------------

            --------------------------------
            Initial Research Output: 
            ${initialResearchOutput}
            --------------------------------
            `,
          },
        ],
        temperature: 1,
        experimental_telemetry: {
          isEnabled: true,
          tracer: getTracer(),
        },
      });
    },
    "generate object for sub questions identification",
    3,
  );

  return {
    subQuestions: response.object.subQuestions,
    usage: {
      [model]: response.usage,
    },
  };
};

export const processFinalReport = async ({
  taskDescription,
  finalReportPrompt,
  topic,
  referencePeriod,
  initialResearchOutput,
  subQuestions,
  model = MODELS.GROK_4_1_FAST,
}: {
  taskDescription: string;
  finalReportPrompt: string;
  topic: string;
  referencePeriod: string;
  initialResearchOutput: InitialResearchOutput;
  subQuestions: SubQuestionAnswer["subQuestions"];
  model?: MODELS;
}): Promise<{
  report: string;
  usage: Record<string, LanguageModelUsage>;
}> => {
  const llm = getLLM(model);
  const providerOptions = getProviderOptions(model, "default");
  const finalPrompt = `
	You are part of a multi-step process to generate a complete report related to a topic.
Your task is the final one: the creation of the actual final report using inputs from previous steps.

Task description: ${taskDescription}
Detailed report instructions:
${finalReportPrompt}
--------------------------------
  `;

  const userMessage = `
  Topic: ${topic}
  Reference Period: ${referencePeriod}
  Current Date: ${new Date().toISOString().split("T")[0]}
  --------------------------------
  Initial Research Output: ${initialResearchOutput.researchOutput}
  --------------------------------
  Sub Questions Answers: 
  
  ${subQuestions
    .map(
      (subQuestion) => `
  --------------------------------
  Question: ${subQuestion.question}
  Answer: ${subQuestion.answer}
  --------------------------------
  `,
    )
    .join("\n")}
  --------------------------------
  `;
  const response = await generateText({
    model: llm,
    messages: [
      { role: "system", content: finalPrompt },
      {
        role: "user",
        content: userMessage,
      },
    ],
    providerOptions,
    experimental_telemetry: {
      isEnabled: true,
      tracer: getTracer(),
    },
  });

  return {
    report: response.text,
    usage: {
      [model]: response.usage,
    },
  };
};

const persistStepOutput = async (
  reportId: string,
  stepOutputs: Partial<StepOutputs>,
  usage?: Record<string, LanguageModelUsage>,
) => {
  const updateData: Record<string, unknown> = {
    stepOutputs: stepOutputs,
  };

  if (usage) {
    updateData.usage = usage;
  }

  await executeWithRetries(async () => {
    await db.update(structuredReports).set(updateData).where(eq(structuredReports.id, reportId));
  }, "persist step output");
};

const updateReportStatus = async (
  reportId: string,
  status: "pending" | "in_progress" | "completed" | "failed",
) => {
  await executeWithRetries(async () => {
    await db.update(structuredReports).set({ status }).where(eq(structuredReports.id, reportId));
  }, "update report status");
};

export const getReportTitleAndSummary = async (
  reportContent: string,
  model: MODELS = MODELS.GROK_4_1_FAST,
) => {
  const llm = getLLM(model);
  const response = await generateObject({
    model: llm,
    messages: [
      { role: "system", content: "Extract title and summary for the report." },
      { role: "user", content: reportContent },
    ],
    schema: z.object({
      title: z.string(),
      summary: z.string(),
    }),
  });
  return {
    title: response.object.title,
    summary: response.object.summary,
    usage: response.usage,
  };
};

export const processStructuredReport = async ({
  reportId,
  reprocess = false,
}: {
  reportId: string;
  reprocess: boolean;
}) => {
  const logger = createContextLogger({
    agent: "structuredReport",
    reportId,
  });

  const report = await db.query.structuredReports.findFirst({
    where: eq(structuredReports.id, reportId),
  });
  if (!report) throw new Error("Report not found");

  const outline = await db.query.structuredReportTemplate.findFirst({
    where: eq(structuredReportTemplate.id, report.templateId),
  });
  if (!outline) throw new Error("Report template not found");

  const prompts = outline.prompts as Record<string, string>;
  const modelConfig = report.modelConfig ?? {};

  const stepOutputs: Partial<StepOutputs> = report.stepOutputs || {};
  const usage: Record<string, LanguageModelUsage> = report.usage ?? {};

  const aggregateUsage = (newUsage: Record<string, LanguageModelUsage>) => {
    for (const [m, mu] of Object.entries(newUsage)) {
      mergeTokenUsage(usage, m, mu);
    }
  };

  if (report.status === "pending" || report.status === "indexing" || reprocess) {
    await updateReportStatus(reportId, "in_progress");
  }

  try {
    // Step 1: Initial Research
    let initialResearchOutput: InitialResearchOutput & {
      usage?: Record<string, LanguageModelUsage>;
    };
    if (stepOutputs.initialResearch && !reprocess) {
      initialResearchOutput = stepOutputs.initialResearch;
    } else {
      initialResearchOutput = await processInitialResearch({
        taskDescription: outline.taskDescription,
        initialResearchPrompt: prompts.initialResearchPrompt,
        topic: report.topic,
        referencePeriod: report.referencePeriod || "",
        userId: report.userId,
        orgId: "",
        model: modelConfig.initialResearch as MODELS | undefined,
      });
      stepOutputs.initialResearch = { researchOutput: initialResearchOutput.researchOutput };
      aggregateUsage(initialResearchOutput.usage ?? {});
      await persistStepOutput(reportId, stepOutputs, usage);
    }

    // Step 2: Sub-questions identification
    let subQuestionsOutput: SubQuestionsIdentificationOutput & {
      usage?: Record<string, LanguageModelUsage>;
    };
    if (stepOutputs.subQuestionsIdentification && !reprocess) {
      subQuestionsOutput = stepOutputs.subQuestionsIdentification;
    } else {
      subQuestionsOutput = await processSubQuestionsIdentification({
        taskDescription: outline.taskDescription,
        initialResearchOutput: initialResearchOutput.researchOutput,
        subQuestionsIdentificationPrompt: prompts.subQuestionsIdentificationPrompt,
        topic: report.topic,
        referencePeriod: report.referencePeriod || "",
        model: modelConfig.subQuestionsIdentification as MODELS | undefined,
      });
      stepOutputs.subQuestionsIdentification = { subQuestions: subQuestionsOutput.subQuestions };
      aggregateUsage(subQuestionsOutput.usage ?? {});
      await persistStepOutput(reportId, stepOutputs, usage);
    }

    // Step 3: Answering sub-questions
    if (!stepOutputs.subQuestionAnswer) {
      stepOutputs.subQuestionAnswer = { subQuestions: [] };
    }
    const existingAnswers = stepOutputs.subQuestionAnswer.subQuestions;
    const limit = pLimit(10);

    const tasks = subQuestionsOutput.subQuestions.map(
      (q: SubQuestionsIdentificationOutput["subQuestions"][0], index: number) =>
        limit(async () => {
          const existing = existingAnswers.find(
            (ans: SubQuestionAnswer["subQuestions"][0]) => ans.question === q.question,
          );
          if (existing && !reprocess) return existing;

          const answer =
            modelConfig.subQuestionAnswerMethod === "similaritySearch"
              ? await processIndividualSubQuestionWithChunkSearch({
                  taskDescription: outline.taskDescription,
                  subQuestion: q,
                  topic: report.topic,
                  referencePeriod: report.referencePeriod || "",
                  userId: report.userId,
                  orgId: "",
                  model: modelConfig.subQuestionAnswer as MODELS | undefined,
                })
              : await processIndividualSubQuestion({
                  taskDescription: outline.taskDescription,
                  subQuestion: q,
                  topic: report.topic,
                  referencePeriod: report.referencePeriod || "",
                  userId: report.userId,
                  orgId: "",
                  model: modelConfig.subQuestionAnswer as MODELS | undefined,
                });

          aggregateUsage(answer.usage);
          return answer;
        }),
    );

    const answers = await Promise.all(tasks);
    stepOutputs.subQuestionAnswer = { subQuestions: answers };
    await persistStepOutput(reportId, stepOutputs, usage);

    // Step 4: Final report
    let finalReportOutput: FinalReportOutput & { usage?: Record<string, LanguageModelUsage> };
    if (stepOutputs.finalReport && !reprocess) {
      finalReportOutput = stepOutputs.finalReport;
    } else {
      const initialResearchOutput = stepOutputs.initialResearch;
      if (!initialResearchOutput) {
        throw new Error("Missing initial research output for final report generation.");
      }
      finalReportOutput = await processFinalReport({
        taskDescription: outline.taskDescription,
        finalReportPrompt: prompts.finalReportPrompt,
        topic: report.topic,
        referencePeriod: report.referencePeriod || "",
        initialResearchOutput,
        subQuestions: stepOutputs.subQuestionAnswer?.subQuestions,
        model: modelConfig.finalReport as MODELS | undefined,
      });
      stepOutputs.finalReport = { report: finalReportOutput.report };
      aggregateUsage(finalReportOutput.usage ?? {});
      await persistStepOutput(reportId, stepOutputs, usage);
    }

    // Finalize
    const meta = await getReportTitleAndSummary(finalReportOutput.report);
    const sources = await parseSources(finalReportOutput.report);

    await db
      .update(structuredReports)
      .set({
        status: "completed",
        finalOutput: finalReportOutput.report,
        metadata: meta,
        sources: sources,
      })
      .where(eq(structuredReports.id, reportId));

    return stepOutputs;
  } catch (error) {
    await updateReportStatus(reportId, "failed");
    throw error;
  }
};

export const processStructuredReportWithObserver = async ({
  reportId,
  reprocess = false,
}: {
  reportId: string;
  reprocess: boolean;
}) => {
  return observe(
    { name: "processStructuredReport" },
    async (reportId, reprocess) => {
      return await processStructuredReport({ reportId, reprocess });
    },
    reportId,
    reprocess,
  );
};
