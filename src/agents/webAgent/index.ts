import { getLLM } from "@/ai/llm";
import { DEFAULT_SMALL_MODEL } from "@/ai/llm";
import { generateText, stepCountIs } from "ai";
import { exaSearch, webSearchTool, exaWebsiteContent } from "@/agents/tools";
import { MODELS } from "@/@types/llm";
import { parseJson } from "@/utils/parseJson";
import { logger } from "@/utils/logger";
import { type GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";

export type SourcesType = {
  sources: {
    url: string;
    title: string;
    type: "pdf" | "website";
    description: string;
  }[];
};
const SYSTEM_PROMPT = `
You are an expert web research analyst specializing in finding and curating high-quality documents and resources.
Your primary objective is to conduct comprehensive web searches and return the most relevant, authoritative document links.

## ROLE & OBJECTIVES
- **Primary Goal**: Find and catalog relevant document links (PDFs, HTML pages) and authoritative web resources
- **Focus**: Prioritize official sources, academic papers, government documents, and reputable organizations
- **Scope**: Be thorough and comprehensive in your search strategy
- **Current Date**: ${new Date().toISOString().split("T")[0]}

## SEARCH STRATEGY
1. **Source Prioritization**:
   - Official government websites and documents
   - Academic institutions and research papers
   - Reputable organizations and institutions
   - Industry reports and white papers
   - News articles from established media outlets

2. **Search Approach**:
   - Use multiple search terms and variations
   - DO NOT FILTER BY DEFAULT FOR DOMAINS, first try to get information from direct search and see if there are relevant sources present if not then try to filter by domains
   - Leverage parallel searches for efficiency (max 5 concurrent)
   - Iterate and refine searches based on initial results

3. **Quality Standards**:
   - Verify source credibility and authority
   - Ensure content relevance to the query
   - Avoid duplicate or low-quality sources
   - Focus on recent and up-to-date information when applicable

## TOOL USAGE
**Available Tools**:
- 'exaSearch': Web search using Exa : Works like a google search and returns links, titles, descriptions of the results,
- 'exaWebsiteContent': Extract content from specific websites using Exa

**Usage Guidelines**:
- Maximum 10 tool calls total (concurrent calls should be less than 5)
- Use parallel calls efficiently (max 3 concurrent)
- For PDFs: Only collect and return document links, do not extract content
- For websites: Only collect and return website links, do not extract content
- Combine different search strategies for comprehensive coverage
- DO NOT ASK USER TO DOWNLOAD ANYTHING - just provide the relevant document links
 - You must keep the search process like a real human wo do, without complex keywords
- DO not ask for clarification just try your best with whats provided to you
- Do not share generic links like investor page of company or company sec page etc, only the pages which contain documents requested by user
- DO NOT CALL MORE THAN 3 TOOL CALLS IN PARALLEL
## OUTPUT FORMAT
Return your findings in the following JSON structure, along with any helpful explanatory text:
- Remember to must wrap the json in \`\`\`json and \`\`\`

\`\`\`json
{
    "sources": [
        {
            "url": "https://example.com/document.pdf",
            "title": "Document Title",
            "type": "pdf",
            "description": "Brief, informative description of the document's content and relevance"
        },
        {
            "url": "https://example.com/resource",
            "title": "Resource Title",
            "type": "website",
            "description": "Brief description of the website content and its relevance"
        }
    ]
}
\`\`\`

## SUCCESS CRITERIA
- Find all the relevant document links
- Ensure diversity in source types (PDFs, websites, different domains)
- Provide clear, descriptive titles and descriptions
- Demonstrate comprehensive search coverage
- Maintain focus on authoritative and official sources
- Return only document links, not content
- DO NOT RETURN PAGES WHERE THE RELEVANT DOCUMENT IS AVAILBLE AS LINK, TRY TO GET THE DOCUMENT LINK
- Give preference to PDF documents than html pages and make sure to return only the links returned from tools
`;

export const webAgent = async (query: string) => {
  const llm = getLLM(MODELS.GROK_CODE_FAST_1);
  const response = await generateText({
    model: llm,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: query },
    ],
    tools: {
      exaSearch,
      exaWebsiteContent,
    },
    onStepFinish: (step) => {
      console.log("Reasoning", step.reasoning);
      if (step.toolCalls) {
        console.log("Tool calls", step.toolCalls);
      }
    },
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: 2048,
        },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    stopWhen: stepCountIs(30),
    temperature: 1,
  });

  console.log("💰 Total tokens", response.usage);

  // Try loading json from the response
  let sources: SourcesType | null = null;
  try {
    sources = parseJson(response.text) as SourcesType | null;
  } catch (error) {}

  if (!sources) {
    const res = (parseJson(response.text) as SourcesType) ?? null;
    if (res) {
      sources = res;
    }
  }

  if (!sources) {
    return {
      sources: [],
      helpfulText: response.text,
    };
  }

  // Replace json with markdown code block
  const helpfulText = response.text.replace(/```json\s*([\s\S]*?)\s*```/, "");

  console.log(`Sources: for ${query} ${JSON.stringify(sources, null, 2)}`);
  return {
    sources: sources?.sources,
    helpfulText: helpfulText,
  };
};

const SYSTEM_PROMPT_COMPLEX = `
You are an expert web research analyst your job is to divide the user query into small subtasks which may require 2-3 steps
max to find the relevant document links. Return the subtasks in the following JSON format:

\`\`\`json
{
    "subtasks": [
        "subtask1",
        "subtask2",
        "subtask3"
    ]
}
\`\`\`

Todays date: ${new Date().toISOString().split("T")[0]}

Guidelines:
 - Each subtask should be as such that it doesn't focus on more than a year or an entity like company
 - Do not create overlapping subtasks, for example if one task can easily find info about other subtask alos combine those
 - All the subtasks should be independed of each other and should be able to be executed in parallel
 - If the query is straightforward, you can create only one subtask
 - You must keep the search process like a real human wo do, withougt complex keywords
 - We want to prefer pdf documents than html pages
`;

export const webAgentComplex = async (query: string) => {
  const llm = getLLM(MODELS.GROK_CODE_FAST_1);
  const response = await generateText({
    model: llm,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_COMPLEX },
      { role: "user", content: query },
    ],
    temperature: 1,
  });

  let subtasks: { subtasks: string[] } | null = null;
  try {
    subtasks = JSON.parse(response.text) as { subtasks: string[] };
  } catch (error) {}

  if (!subtasks) {
    const res = parseJson(response.text) as { subtasks: string[] };
    if (res) {
      subtasks = res;
    }
  }

  console.log("Reasoning", response.reasoning);

  if (!subtasks) {
    return {
      resources: [],
      subtasks: [],
    };
  }

  const allResources = (
    await Promise.all(subtasks.subtasks.map((subtask) => webAgent(subtask)))
  )
    .map((resource) => resource.sources)
    .flat();

  return {
    resources: allResources,
    subtasks,
  };
};
