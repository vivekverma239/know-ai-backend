import { z } from "zod";
import { generateObject, generateText, stepCountIs, tool } from "ai";
import { DEFAULT_SMALL_MODEL } from "@/ai/llm";
import { getLLM } from "@/ai/llm";
import type { SimilarChunk } from "@/db/queries/simChunks";
import {
  similaritySearchChunks,
  similaritySearchClusters,
  similaritySearchDocuments,
  similaritySearchTips,
} from "@/service/simSearch";
import { parseJson } from "@/utils/parseJson";
import {
  approachSchema,
  StepType,
  type Approach,
  type StepMessage,
} from "@/@types/agents";
import { logger } from "@/utils/logger";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { chunks, userFileCluster, userFilePage } from "@/db/schema";
import { observe } from "@lmnr-ai/lmnr";
import fs from "fs";
import { chapterAgentV2 } from "../fileAgent/chapterFilter";
import { chapterAgentV3 } from "../fileAgent/chapterV3";

export const SYSTEM_PROMPT_DEEP_RESEARCH = `
You are an expert analyst. Your job is to handle user queries and respond, you have access to another agent
which can does deep research and respond to the user query.
For any query which might require analysis, handoff to the deep research agent. You can use following format to handoff:
\`\`\`json
{{
    "handoff": {{
        "agent": "deep_research",
        "instruction": "instruction for the deep research agent"  # should have all the details of the user query
    }}
}}
\`\`\`
`;

export const ANALYSTS_PERSONAS = [
  {
    name: "Equity analyst",
    description:
      "You are an equity analyst expert in companies competitive/strategic analysis," +
      "companies valuation, accounting, balance sheet and income statements analysis," +
      "analysis of revenue drivers across sectors",
  },
  {
    name: "Financials analyst",
    description:
      "You are a banking sector and insurance sector analyst, expert in banks and insurances " +
      "accounting, banks and insurances regulation, as well as their valuation and analysis, " +
      "and banks and insurances business drivers, competitive drivers and revenues and costs drivers",
  },
  {
    name: "Commodity analyst",
    description:
      "You are a commodities analyst, expert in analyzing drivers of supply and demand of all" +
      "commodities",
  },
  {
    name: "Corporate credit analyst",
    description:
      "You are a credit/legal analyst focusing on corporates, expert in bond prospectuses analysis," +
      "debt restructurings, bankruptcy laws in various countries",
  },
  {
    name: "Corporate credit analyst 2",
    description:
      "You are a credit fundamental analyst, expert in companies credit analysis, recovery analysis," +
      "credit ratios calculation, capital structure analysis with a specific focus on financial liabilities",
  },
  {
    name: "Sovereign credit analyst 1",
    description:
      "You are a credit/legal analyst, expert in bond prospectuses analysis, debt restructurings " +
      "analysis for sovereigns",
  },
  {
    name: "Sovereign credit analyst 2",
    description:
      "You are a sovereign credit analysts, expert in sovereign credit / fiscal analysis",
  },
  {
    name: "Monetary policy analyst",
    description:
      "You are a monetary policy analyst, expert in interpreting central banks policy decisions" +
      "and announcement, and interaction between monetary policy and macro variables",
  },
  {
    name: "M&A analyst",
    description:
      "You are a M&A analyst, expert in analysis of announced mergers, acquisitions, " +
      "leverage buyouts, and other similar transactions, you are expert in analyzing these situation from and " +
      "economic and fundamental point of view and from a regulatory point of view",
  },
  {
    name: "Macro analyst",
    description:
      "You are an economist and macro analyst, expert in economic analysis of countries and " +
      "implication on growth, inflation, interest rates and currencies",
  },
  {
    name: "Political analyst",
    description:
      "You are a political analyst, expert at interpreting political statements, " +
      "political game theory, parliament dynamics, laws, geopolitics",
  },
];

export const SELECT_ANALYST_PROMPT = `
You are an expert analyst. You job is given a user query, select an analyst from the list of analysts, which would be
most suited to answer the user query. Only select one analyst and output the name
User query: {query}

Analysts: {analyst_personas}

You should respond finally with this format with no additional text:
\`\`\`json
{{
    "analyst": "name of the analyst"
}}
\`\`\`
`;

export const APPROACH_PROMPT = `
{analyst_persona_description}

Today's date: {today}
Guidelines:
- Make sure to use the knowledge on your area of expertise and your knowledge of what type of
  information / data is present in which document.
- Create a short approach not very detailed, just with high level steps.
- Assume we have the financial documents of various kinds available in database(pdf).
- The final output of the approach should be a text based report only no visualization
- Emphasize the document types that are needed. If the time period is relevant, also emphasize what
  time periods should the documents cover
- Each step should define all the details
- document_filter is a step which involves filtering the document
- extraction is a step which involves extracting the information from the document
- analysis is a step which involves analyzing all the information and giving the final report
- Make sure to suggest the approach which provides most accurate answer
- Must include years in the details if relevant, like if you mention current year
mention the year in the details
- Extraction step will focus on extracting the information from the document
- Analysis step will focus on analyzing the information and giving the final report
- Make sure to include the year in the details if relevant, like if you mention current year
mention the year in the details

General Tips: {tips}

User Query: {query}

Step by step approach:
\`\`\`json
{{
    "steps": [
        {{
        "details": "details of the step",
        "type": "extraction"  # extraction, analysis
        }}
        "...",
        "..."  # Add more steps if needed
    ]
}}
\`\`\`
`;

export const APPROACH_PROMPT_V2 = `
{analyst_persona_description}

Today's date: {today}
## TASK
You are an expert financial analyst. Your job is to create a systematic approach to answer the user's query by extracting relevant information from financial documents and analyzing it to produce a comprehensive text-based report.

## CORE PRINCIPLES
1. **Accuracy First**: Design approaches that maximize accuracy and reliability
2. **Document-Specific**: Leverage your expertise to identify which document types contain the needed information
3. **Systematic Extraction**: Break down complex queries into discrete extraction steps
4. **Comprehensive Analysis**: Ensure final analysis covers all extracted data points

## GUIDELINES

### Approach Design
- Create concise, high-level steps that are actionable and specific
- Focus on document types that commonly contain the required information (SEC filings, annual reports, 10-Ks, etc.)
- Ensure each step has clear, detailed instructions

### Time Periods
- **ALWAYS** specify exact years in step details when time periods are relevant
- For current year references, explicitly state the year (e.g., "2025" not "current year")
- For multi-year comparisons, create separate extraction steps for each year

### Step Types
**Extraction Steps:**
- Focus on extracting specific data points from financial documents
- Target information commonly found in single documents (e.g., one annual report)
- Be specific about what data to extract and from which document sections

**Analysis Steps:**
- Synthesize and compare extracted information
- Provide insights, trends, and conclusions
- Generate the final comprehensive report

### Multi-Year Comparisons
- Break down into individual year extraction steps
- Create separate extraction steps for each year being compared
- Include a final analysis step that compares all extracted data

### Output Format
- Final output must be text-based only (no visualizations)
- Ensure comprehensive coverage of the query requirements

## RESPONSE FORMAT
Provide your approach in this exact JSON format:

\`\`\`json
{
    "steps": [
        {
            "details": "Specific, detailed instruction for this step",
            "type": "extraction"
        }
    ]
}
\`\`\`

## EXAMPLES

**Example 1: Multi-Year Financial Comparison**
Query: Compare financial statements for Google for last 5 years (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract financial statements for Google for fiscal year 2024 from the latest annual report or 10-K filing, focusing on key metrics like revenue, net income, total assets, and total liabilities.",
            "type": "extraction"
        },
        {
            "details": "Extract financial statements for Google for fiscal year 2023 from the annual report or 10-K filing, capturing the same key metrics as step 1.",
            "type": "extraction"
        },
        {
            "details": "Extract financial statements for Google for fiscal year 2022 from the annual report or 10-K filing, capturing the same key metrics as previous steps.",
            "type": "extraction"
        },
        {
            "details": "Extract financial statements for Google for fiscal year 2021 from the annual report or 10-K filing, capturing the same key metrics as previous steps.",
            "type": "extraction"
        },
        {
            "details": "Extract financial statements for Google for fiscal year 2020 from the annual report or 10-K filing, capturing the same key metrics as previous steps.",
            "type": "extraction"
        },
        {
            "details": "Compare and analyze key financial metrics across all five years (2020-2024), including revenue growth trends, profitability ratios, balance sheet strength, and identify significant changes or patterns in Google's financial performance.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 2: Specific Financial Ratio Analysis**
Query: Analyze the debt-to-equity ratio for Microsoft for the last 3 fiscal years (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract total debt and total equity for Microsoft for fiscal year 2024 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total debt and total equity for Microsoft for fiscal year 2023 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total debt and total equity for Microsoft for fiscal year 2022 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Calculate debt-to-equity ratios for fiscal years 2022, 2023, and 2024. Analyze the trend, discuss implications of changes, and assess Microsoft's capital structure and financial leverage over this period.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 3: Single-Year Data Extraction**
Query: What was the Net Income for Tesla in 2023?

\`\`\`json
{
    "steps": [
        {
            "details": "Extract the Net Income figure for Tesla for fiscal year 2023 from the income statement section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Report the extracted Net Income for Tesla for fiscal year 2023 and provide context about this figure in relation to Tesla's historical performance.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 4: Cross-Company Comparison**
Query: Compare the Cash Flow from Operations for Amazon and Walmart for the fiscal year 2024 (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract the Cash Flow from Operations for Amazon for fiscal year 2024 from the cash flow statement section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract the Cash Flow from Operations for Walmart for fiscal year 2024 from the cash flow statement section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Compare the Cash Flow from Operations for Amazon and Walmart for fiscal year 2024, analyzing which company generated more cash from core operations, discussing potential reasons for differences, and providing insights into their operational efficiency.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 5: Revenue Segment Analysis**
Query: Analyze Apple's revenue breakdown by product segment for the last 3 years (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract revenue breakdown by product segment (iPhone, Mac, iPad, Services, Wearables, Home and Accessories) for Apple for fiscal year 2024 from the segment reporting section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract revenue breakdown by product segment for Apple for fiscal year 2023 from the segment reporting section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract revenue breakdown by product segment for Apple for fiscal year 2022 from the segment reporting section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Analyze Apple's revenue trends by product segment across fiscal years 2022-2024, identifying growth drivers, declining segments, and shifts in revenue mix. Provide insights into Apple's strategic focus and market performance.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 6: Profitability Ratio Analysis**
Query: Calculate and analyze the Return on Equity (ROE) for Microsoft for the last 5 years (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract net income and total shareholders' equity for Microsoft for fiscal year 2024 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract net income and total shareholders' equity for Microsoft for fiscal year 2023 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract net income and total shareholders' equity for Microsoft for fiscal year 2022 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract net income and total shareholders' equity for Microsoft for fiscal year 2021 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract net income and total shareholders' equity for Microsoft for fiscal year 2020 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Calculate ROE for each fiscal year (2020-2024) and analyze the trend, discussing factors that may have influenced changes in Microsoft's profitability and efficiency in generating returns for shareholders.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 7: Balance Sheet Strength Analysis**
Query: Analyze Tesla's liquidity ratios (Current Ratio and Quick Ratio) for the last 3 years (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract current assets, current liabilities, and inventory for Tesla for fiscal year 2024 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract current assets, current liabilities, and inventory for Tesla for fiscal year 2023 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract current assets, current liabilities, and inventory for Tesla for fiscal year 2022 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Calculate Current Ratio and Quick Ratio for Tesla for fiscal years 2022-2024. Analyze Tesla's short-term liquidity position, ability to meet short-term obligations, and trends in working capital management.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 8: Capital Structure Analysis**
Query: Analyze the debt-to-equity and debt-to-assets ratios for Amazon for the last 4 years (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract total debt, total equity, and total assets for Amazon for fiscal year 2024 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total debt, total equity, and total assets for Amazon for fiscal year 2023 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total debt, total equity, and total assets for Amazon for fiscal year 2022 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total debt, total equity, and total assets for Amazon for fiscal year 2021 from the balance sheet section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Calculate debt-to-equity and debt-to-assets ratios for Amazon for fiscal years 2021-2024. Analyze Amazon's capital structure, leverage levels, and financial risk profile over this period.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 9: Cash Flow Analysis**
Query: Analyze the components of Tesla's cash flow statement for fiscal year 2024 (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract operating cash flow, investing cash flow, and financing cash flow components for Tesla for fiscal year 2024 from the cash flow statement section of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract key cash flow items including capital expenditures, debt issuances/repayments, stock repurchases, and dividend payments for Tesla for fiscal year 2024 from the cash flow statement.",
            "type": "extraction"
        },
        {
            "details": "Analyze Tesla's cash flow components for fiscal year 2024, discussing the company's cash generation from operations, investment activities, financing decisions, and overall cash flow health.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 10: Earnings Per Share (EPS) Analysis**
Query: Compare the diluted EPS for Google and Meta for the last 3 years (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract diluted earnings per share for Google for fiscal years 2024, 2023, and 2022 from the income statement or earnings per share section of their annual reports or 10-K filings.",
            "type": "extraction"
        },
        {
            "details": "Extract diluted earnings per share for Meta for fiscal years 2024, 2023, and 2022 from the income statement or earnings per share section of their annual reports or 10-K filings.",
            "type": "extraction"
        },
        {
            "details": "Compare the diluted EPS performance for Google and Meta across fiscal years 2022-2024, analyzing which company has been more profitable on a per-share basis and discussing factors that may have influenced their respective earnings performance.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 11: Asset Turnover Analysis**
Query: Calculate and analyze the asset turnover ratio for Walmart for the last 5 years (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract total revenue and average total assets for Walmart for fiscal year 2024 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total revenue and average total assets for Walmart for fiscal year 2023 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total revenue and average total assets for Walmart for fiscal year 2022 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total revenue and average total assets for Walmart for fiscal year 2021 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total revenue and average total assets for Walmart for fiscal year 2020 from the income statement and balance sheet sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Calculate asset turnover ratios for Walmart for fiscal years 2020-2024 and analyze the company's efficiency in generating revenue from its asset base, discussing trends and operational effectiveness.",
            "type": "analysis"
        }
    ]
}
\`\`\`

**Example 12: Dividend Analysis**
Query: Analyze the dividend payout ratio and dividend yield for Microsoft for the last 4 years (current year is 2025)

\`\`\`json
{
    "steps": [
        {
            "details": "Extract total dividends paid and net income for Microsoft for fiscal year 2024 from the cash flow statement and income statement sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total dividends paid and net income for Microsoft for fiscal year 2023 from the cash flow statement and income statement sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total dividends paid and net income for Microsoft for fiscal year 2022 from the cash flow statement and income statement sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Extract total dividends paid and net income for Microsoft for fiscal year 2021 from the cash flow statement and income statement sections of their annual report or 10-K filing.",
            "type": "extraction"
        },
        {
            "details": "Calculate dividend payout ratios for Microsoft for fiscal years 2021-2024 and analyze the company's dividend policy, sustainability of dividend payments, and commitment to returning capital to shareholders.",
            "type": "analysis"
        }
    ]
}
\`\`\`

User Query: {query}
Current date: ${new Date().toISOString()}
`;

const DOCUMENT_FINDER_SYSTEM_PROMPT = `
You are an expert financial research assistant. Given the user query, your job is to make queries using the document
search tool which would return the document information based on the query. Make sure to use the tool multiple times
and get all the relevant documents whicis_sufficienth could have relevant information to the user query.

Guidelines:
- Make sure to do an exhaustive search and get all the relevant documents.
- You must try multiple times with different queries to ensure that you have found all relevant documents.
- The goal here is to be exhaustive and find all relevant documents.
- Make sure to return all the documents which could be relevant to the user query.
- You should try at most 3 times and after that return the most relevant documents.
Current date: {today}

User Query: {query}
When you are done, you should return a list of documents which could have relevant information to the user query.
you should respond finally with this format :
\`\`\`json
{
    "documents": [
        {
            "id": "123", # object id
            "title": "document_name"
        }
        ...
    ]
}
\`\`\`
`;

const RAG_PROMPT = `
You are an expert research assistant. Given the user query, and a set of relevant documents, your job is to
use the search tool which would fetch the relevant chunks from the documents. The final output should be
a comprehensive report based on the query. You goal should be to make sure explore all the relevant documents
and give the best possible answer.

Guidelines:
- Make sure to use the search tool multiple times to ensure that you have fetched all relevant chunks.
- The goal here is to be exhaustive and fetch all relevant chunks.
- Only respond when you have all the relevant information to answer the user query.
- If there is not enough information to answer the user query, provide a helpful response along
with mentioning that you need more information.
- Make sure to form queries which are relevant based on the kind of documents
- Make sure to output a detailed response with all the relevant information. And also mention the exact references
from the documents. Also mention the step by step process you took to get the answer.
- Make sure to perform all the searches before responding.

Make sure to add inline citations in the following format:
Apples net revenue was $100 million in 2022 [1](/doc/{documentId}/page/{pageNumber})
where documentId is the id returned for the document in the knowledge base.

Query: {query}
Relevant documents: {documents}

Current date: ${new Date().toISOString()}
`;

const RESPONSE_PROMPT = `
You are an expert research assistant. Your job is to prepare a final
comprehensive response based on different pages fetched from the documents.
Make sure to use the data fetched from the documents to prepare the final response, don't make up any information.

Guidelines:
- Make sure to highlight all the details, breakdown any calculations and also mention references/limitations if any

Current date: {today}
User Query: {query}

DocumentPages: {document_pages}

Make sure to add inline citations in the following format:
Apples net revenue was $100 million in 2022 [1](/doc/{documentId}/page/{pageNumber})
where documentId is the id of the document and pageNumber is the page number of the document.
`;

type Step = Approach["steps"][number];
type StepResponse = {
  details: string;
  type: Step["type"];
};

// const processStep = async (step: Step) => {
//     if (step.type === "document_filter") {
//         return await processDocumentFilter(step.details);
//     }
// }

const respondStep = async (query: string, chunks: SimilarChunk[]) => {
  const llm = getLLM(DEFAULT_SMALL_MODEL);
  const response = await generateText({
    model: llm,
    prompt: RESPONSE_PROMPT.replace("{query}", query)
      .replace("{document_pages}", JSON.stringify(chunks))
      .replace("{today}", new Date().toISOString()),
    experimental_telemetry: {
      isEnabled: true,
    },
  });
  return response.text;
};

export const respondStepWithObserver = async (
  query: string,
  chunks: SimilarChunk[]
) => {
  const fn = async () =>
    observe(
      { name: "respondStep" },
      (query, chunks) => respondStep(query, chunks),
      query,
      chunks
    );
  return await fn();
};

export const documentFilter = async (step: Step) => {
  const llm = getLLM(DEFAULT_SMALL_MODEL);

  const response = await generateText({
    model: llm,
    stopWhen: stepCountIs(5),
    tools: {
      documentSearch: tool({
        description: "Search for documents based on the query",
        inputSchema: z.object({
          query: z.string(),
        }),
        execute: async ({ query }) => {
          console.log("query", query);
          const documents = await similaritySearchDocuments(query);
          console.log("documents", documents);
          return documents;
        },
      }),
    },
    prompt: DOCUMENT_FINDER_SYSTEM_PROMPT.replace(
      "{today}",
      new Date().toISOString()
    ).replace("{query}", step.details),
    temperature: 2,
    experimental_telemetry: {
      isEnabled: true,
    },
  });

  const documents = parseJson(response.text) as {
    documents: { id: string; title: string }[];
  } | null;
  if (!documents) {
    console.log(response.text);
    console.log("No documents found");
    return null;
  }
  return documents.documents;
};

export const documentFilterWithObserver = async (step: Step) => {
  const fn = async () =>
    observe(
      {
        name: "documentFilter",
      },
      (step) => documentFilter(step),
      step
    );
  return await fn();
};

export const chunkSearch = async (
  query: string,
  documents: { id: string; title: string }[],
  callback?: (step: StepMessage) => void
) => {
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
        content: c.content.slice(0, 100) + "...",
      })),
    },
  });
  return sortedChunks.slice(0, 10).map((c) => ({
    documentId: c.documentId,
    content: c.content,
  })) as SimilarChunk[];
};

const handleChapterSearch = async (
  query: string,
  callback?: (step: StepMessage) => void
) => {
  console.log("Chapter agent search");
  const response = await chapterAgentV2(query, callback);
  // Find document reference with regex
  const documentReferenceRegex = /\[(\d+)\]\(\/doc\/[a-f0-9-]+\/page\/(\d+)\)/g;
  const matches = response.match(documentReferenceRegex);
  // if (!matches) {
  //   throw new Error("No document reference found");
  // }
  const documentIds = matches
    ?.map((match) => match.split("/")[2])
    .filter((it) => it !== undefined);

  return [
    {
      content: response,
      similarity: 1,
      documentId: documentIds?.[0] ?? "",
    },
  ];
};

export const chunkSearchWithObserver = async (
  query: string,
  documents?: { id: string; title: string }[],
  callback?: (step: StepMessage) => void,
  version: "v1" | "v2" | "v3" | "v4" | "indexSearch" | "agentSearch" = "v1"
) => {
  const fn = async () =>
    observe(
      {
        name: `chunkSearch-${version}`,
      },
      (query) => handleChapterSearch(query, callback),
      // version === "v1"
      //   ? chunkSearch(query, documents, callback)
      //   : version === "v2"
      //     ? agenticChunkSearch(query, documents)
      //     : version === "v3"
      //       ? agenticChunkSearchV2(query, documents)
      //       : version === "v4"
      //         ? agenticChunkSearchV3(query, documents)
      //         : version === "indexSearch"
      //           ? indexSearch(query, documents, callback)
      //           : version === "agentSearch"
      //             ? handleChapterSearch(query, documents)
      //             : chunkSearch(query, documents, callback),
      query,
      documents
    );
  return await fn();
};

export const agenticChunkSearch = async (
  query: string,
  documents: { id: string; title: string }[]
) => {
  console.log("Query", query);
  console.log("Documents", documents);
  const llm = getLLM(DEFAULT_SMALL_MODEL);
  const response = await generateText({
    model: llm,
    stopWhen: stepCountIs(10),
    messages: [
      {
        role: "user",
        content: `
    You are an expert fiancial analyst. Your job is given the query and list
    of documents, use the documentSearch tool to get the relevant chunks. If the relevant chunks are found return
    the chunk ids. Try multiple queries to make sure to be exhaustive.
    Query: ${query}
    Documents: ${JSON.stringify(documents)}

    Use the following format to answer when you are done and have identified the chunks, make
    sure to return the chunk ids which could be helpful in any way to answer the query:
    Chunk ids are uuid strings with id key in chunk docs
    \`\`\`json
    {
      "chunkIds": ["chunkId1", "chunkId2", "chunkId3"]
    }
    \`\`\`
    `,
      },
    ],
    temperature: 1,
    tools: {
      documentSearch: tool({
        description: "Search for documents based on the query",
        inputSchema: z.object({
          documents: z.array(
            z.object({
              id: z.string(),
              queries: z
                .array(z.string())
                .describe("List of things to extract from the document"),
            })
          ),
        }),
        execute: async ({
          documents,
        }: {
          documents: { id: string; queries: string[] }[];
        }) => {
          logger.info(
            `Searching for chunks for documents: ${JSON.stringify(documents)}`
          );
          const chunkPromises = [];
          for (const document of documents) {
            for (const query of document.queries) {
              chunkPromises.push(
                similaritySearchChunks({
                  query,
                  documentIds: [document.id],
                  limit: 5,
                  includeChunkId: true,
                  page: 1,
                })
              );
            }
          }
          const chunks = await Promise.all(chunkPromises);
          for (const chunk of chunks.flat()) {
            logger.debug(`Chunk: ${chunk.id} - ${chunk.content.slice(0, 100)}`);
          }
          return chunks.flat();
        },
      }),
    },
  });

  const res = response.text;
  const json = parseJson(res) as {
    chunkIds: string[];
  };
  if (!json) {
    throw new Error("No json found");
  }
  const chunkIds = json.chunkIds;
  console.log("Chunk ids", chunkIds);
  // Load chunks
  const chunksData = await db
    .select()
    .from(chunks)
    .where(inArray(chunks.id, chunkIds));
  return chunksData.map((c) => ({
    documentId: c.documentId,
    content: c.content,
  })) as SimilarChunk[];
};

export const agenticChunkSearchV2 = async (
  query: string,
  documents: { id: string; title: string }[]
) => {
  const llm = getLLM(DEFAULT_SMALL_MODEL);
  const response = await generateText({
    model: llm,
    prompt: `
    You are an expert fiancial analyst. Your job is given the query and list
    of documents, use the documentSearch tool to get the relevant pages, which
    might have relevant information to the query. If the relevant pages are found return
    the page numbers. Try multiple queries to make sure to be exhaustive.
    Query: {query}
    Documents: {documents}

    Use the following format to answer when you are done and have identified the pages, make
    sure to return the page numbers which could be helpful in any way to answer the query:
    Page numbers are numbers with page key in page docs
    \`\`\`json
    [{
      "documentId": "documentId",
      "pageNumbers": [1, 2, 3],
      "reason": "reason for the page numbers"
  }]
    \`\`\`
    `
      .replace("{query}", query)
      .replace("{documents}", JSON.stringify(documents)),
    temperature: 1,

    tools: {
      documentSearch: tool({
        description: "Search for documents based on the query",
        inputSchema: z.object({
          query: z.string(),
        }),
        execute: async ({ query }) => {
          const chunks = await similaritySearchClusters(
            query,
            documents.map((d) => d.id),
            3,
            false
          );
          // logger.info(`Chunks: ${JSON.stringify(chunks, null, 2)}`);
          console.log("Query", query);
          console.log(
            `Chunks:
            ${JSON.stringify(
              chunks.map((c) => ({
                startPage: c.startPage,
                endPage: c.endPage,
                // summary: c.summary,
                // pageSummaries: c.pageSummaries?.map((p) => p.summary),
              })),
              null,
              2
            )}

            `,
            JSON.stringify(chunks, null, 2)
          );
          return chunks;
        },
      }),
    },
    experimental_telemetry: {
      isEnabled: true,
    },
    stopWhen: stepCountIs(10),
  });

  const res = response.text;
  const json = parseJson(res) as {
    documentId: string;
    pageNumbers: number[];
  }[];
  if (!json) {
    throw new Error(`No json found : Response ${res}`);
  }

  logger.info(`Pages: ${JSON.stringify(json, null, 2)}`);

  const pages = [];
  for (const doc of json) {
    const docPages = await db
      .select()
      .from(userFilePage)
      .where(
        and(
          inArray(userFilePage.pageNumber, doc.pageNumbers),
          eq(userFilePage.fileId, doc.documentId)
        )
      );
    pages.push(
      ...docPages.map((p) => ({
        documentId: p.fileId,
        pageNumber: p.pageNumber,
        content: p.content,
      }))
    );
  }
  return pages.map((p) => ({
    documentId: p.documentId,
    pageNumber: p.pageNumber,
    content: p.content,
    similarity: 0,
  })) as SimilarChunk[];
};

export const agenticChunkSearchV3 = async (
  query: string,
  documents: { id: string; title: string }[]
) => {
  console.log("Query", query);
  const llm = getLLM(DEFAULT_SMALL_MODEL);
  const documentWithOutline = await Promise.all(
    documents.map(async (d) => {
      try {
        const clusters = await db
          .select()
          .from(userFileCluster)
          .where(eq(userFileCluster.fileId, d.id));

        if (!clusters[0]) {
          logger.warn(`No file found for document ID: ${d.id}`);
          return { ...d, outline: [] };
        }

        const pages = [];
        const coveredPages = new Set<number>();
        for (const cluster of clusters) {
          pages.push(
            ...(cluster.pageSummaries?.filter(
              (p) => !coveredPages.has(p.page_number)
            ) ?? [])
          );
          for (const page of cluster.pageSummaries ?? []) {
            coveredPages.add(page.page_number);
          }
        }

        return {
          ...d,
          outline: pages,
        };
      } catch (error) {
        console.log(error);
        logger.error(`Error fetching file for document ID: ${d.id}`);
        return { ...d, outline: [] };
      }
    })
  );

  // Save documentWithOutline to file
  fs.writeFileSync(
    "documentWithOutline.json",
    JSON.stringify(documentWithOutline, null, 2)
  );
  const response = await generateText({
    model: llm,
    prompt: `
    You are an expert fiancial analyst. Your job is given the query and given
    the document outline, identify the relevant pages, which might have relevant
    might have relevant information to the query. If the relevant pages are found return
    the page numbers.
    Query: {query}
    Documents: {documents}

    Use the following format to answer when you are done and have identified the pages, make
    sure to return the page numbers which could be helpful in any way to answer the query:
    Page numbers are numbers with page key in page docs
    \`\`\`json
    [{
      "documentId": "documentId",
      "pageNumbers": [1, 2, 3],
      "explanation": "explanation for the page numbers"
  }]
    \`\`\`
    `
      .replace("{query}", query)
      .replace("{documents}", JSON.stringify(documentWithOutline)),
    temperature: 1,

    // tools: {
    //   documentSearch: tool({
    //     description: "Search for documents based on the query",
    //     parameters: z.object({
    //       query: z.string(),
    //     }),
    //     execute: async ({ query }: { query: string }) => {
    //       const chunks = await similaritySearchClusters(
    //         query,
    //         documents.map((d) => d.id),
    //         3,
    //         true,
    //       );
    //       // logger.info(`Chunks: ${JSON.stringify(chunks, null, 2)}`);
    //       console.log("Query", query);
    //       console.log(
    //         `Chunks: ${JSON.stringify(
    //           chunks.map((c) => ({
    //             startPage: c.startPage,
    //             endPage: c.endPage,
    //             summary: c.summary,
    //           })),
    //           null,
    //           2,
    //         )}`,
    //       );
    //       return chunks;
    //     },
    //   }),
    // },
    experimental_telemetry: {
      isEnabled: true,
    },
  });

  const res = response.text;
  const json = parseJson(res) as {
    documentId: string;
    pageNumbers: number[];
    explanation: string;
  }[];
  if (!json) {
    throw new Error(`No json found : Response ${res}`);
  }

  logger.info(`Pages: ${JSON.stringify(json, null, 2)}`);

  const pages = [];
  for (const doc of json) {
    const docPages = await db
      .select()
      .from(userFilePage)
      .where(
        and(
          inArray(userFilePage.pageNumber, doc.pageNumbers),
          eq(userFilePage.fileId, doc.documentId)
        )
      );
    pages.push(
      ...docPages.map((p) => ({
        documentId: p.fileId,
        pageNumber: p.pageNumber,
        content: p.content,
      }))
    );
  }
  return pages.map((p) => ({
    documentId: p.documentId,
    pageNumber: p.pageNumber,
    content: p.content,
    similarity: 0,
  })) as SimilarChunk[];
};

export const ragExtraction = async (
  query: string,
  documents: { id: string; title: string }[]
) => {
  const relevantDocumentIds = documents.map((d) => d.id);
  const llm = getLLM(DEFAULT_SMALL_MODEL);
  const response = await generateText({
    model: llm,
    stopWhen: stepCountIs(10),
    tools: {
      search: tool({
        description: "Search within the documents based on the query",
        inputSchema: z.object({
          query: z.string().describe("Fully formed query not just keywords"),
        }),
        execute: async ({ query }: { query: string }) => {
          const chunks = await similaritySearchChunks({
            query,
            documentIds: relevantDocumentIds,
            limit: 5,
            page: 1,
          });
          return chunks;
        },
      }),
    },
    prompt: RAG_PROMPT.replace("{query}", query).replace(
      "{documents}",
      JSON.stringify(documents)
    ),
    temperature: 1,
    experimental_telemetry: {
      isEnabled: true,
    },
  });
  console.log("Response", response);
  return response.text;
};

const selectAnalyst = async (query: string) => {
  const llm = getLLM(DEFAULT_SMALL_MODEL);
  const analyst = await generateObject({
    model: llm,
    prompt: SELECT_ANALYST_PROMPT.replace("{query}", query).replace(
      "{analyst_personas}",
      ANALYSTS_PERSONAS.map((a) => a.name).join(", ")
    ),
    schema: z.object({
      analyst: z.enum(
        ANALYSTS_PERSONAS.map((a) => a.name) as [string, ...string[]]
      ),
    }),
    experimental_telemetry: {
      isEnabled: true,
    },
  });
  return analyst.object.analyst;
};

const selectAnalystWithObserver = async (query: string) => {
  const fn = async () =>
    observe(
      {
        name: "selectAnalyst",
      },
      (query) => selectAnalyst(query),
      query
    );
  return await fn();
};

export const generateApproach = async (
  analyst: string,
  query: string,
  callback?: (step: StepMessage) => void
) => {
  const llm = getLLM(DEFAULT_SMALL_MODEL);
  const analystPersona = ANALYSTS_PERSONAS.find((a) => a.name === analyst);
  if (!analystPersona) {
    throw new Error("Analyst not found");
  }
  const tips = await similaritySearchTips(query);
  callback?.({
    id: uuidv4(),
    type: StepType.TIP_SEARCH,
    status: "done",
    message: `Tips fetched: ${tips.map((t) => t.title).join(", ")}`,
    metadata: {
      tips: tips,
    },
  });

  const approach = await generateObject({
    model: llm,
    prompt: APPROACH_PROMPT_V2.replace(
      "{analyst_persona_description}",
      analystPersona.description
    )
      .replace("{today}", new Date().toISOString())
      .replace("{query}", query)
      .replace("{tips}", tips.map((t) => t.content).join("\n")),
    schema: approachSchema,
    experimental_telemetry: {
      isEnabled: true,
    },
  });
  return approach.object;
};

const generateApproachWithObserver = async (
  analyst: string,
  query: string,
  callback?: (step: StepMessage) => void
) => {
  const fn = async () =>
    observe(
      {
        name: "generateApproach",
      },
      (analyst, query) => generateApproach(analyst, query, callback),
      analyst,
      query
    );
  return await fn();
};

export const processDeepSearchQuery = async (
  query: string,
  callback?: (step: StepMessage) => void
) => {
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

  logger.info(`Running chapter agent`);
  // const responseCall = () =>
  //   observe(
  //     { name: "chapterAgentV2" },
  //     async (query: string) => await chapterAgentV2(query, callback),
  //     query,
  //   );
  // const response = await responseCall();

  const responseCall = () =>
    observe(
      { name: "chapterAgentV3" },
      async (query: string) => await chapterAgentV3(query, callback),
      query
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
