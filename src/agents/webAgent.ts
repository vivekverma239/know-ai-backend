import { getLLM } from "@/ai-backend/llm";
import { generateText, stepCountIs } from "ai";
import { MODELS } from "@/@types/llm";
import { parseJson } from "@/utils/parseJson";
import { type GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { createContextLogger } from "@/utils/logger";
import { getWebSearchTool, getFirecrawlScrapeTool, getWebsiteContentTool } from "./tools/websearch";
import type { ToolContext } from "./tools/toolContext";

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

3. **Financial Document Discovery Strategy**:
   When searching for financial documents (10-K, 10-Q, annual reports, quarterly reports, etc.):
   - **Step 1**: First locate the company's official investor relations page
     * Search for "[Company Name] investor relations" or "[Company Name] IR"
     * Common URLs: investor.[company].com, [company].com/investors, [company].com/investor-relations
   - **Step 2**: Navigate from investor relations page to financial documents
     * Look for sections like "Financial Reports", "SEC Filings", "Annual Reports", "Quarterly Reports"
     * Use exaWebsiteContent to extract links from the investor relations page if needed
   - **Step 3**: Direct document links are preferred
     * Once on the investor relations page, find direct links to PDF documents (10-K, 10-Q, annual reports)
     * DO NOT return the investor relations landing page - return the actual document PDF links
   - **Step 4**: Alternative sources if investor relations page doesn't have documents
     * Search SEC EDGAR database: "[Company Name] SEC filings" or "[Company Name] 10-K"
     * Search for "[Company Name] annual report PDF" or "[Company Name] quarterly report PDF"
   - **Best Practice**: Always try to get the direct PDF/document link, not the page that contains the link

4. **Quality Standards**:
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
- For financial documents: You may use investor relations pages or SEC pages as intermediate steps to locate documents, but ONLY return the direct document links (PDFs) in your final output, NOT the investor relations landing pages or SEC filing index pages
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
- For financial documents: Successfully navigate from investor relations pages to actual document PDFs, not just the landing pages
`;

export const webAgent = async (query: string, context: ToolContext) => {
    const agentLogger = createContextLogger({
        agent: "webAgent",
        phase: "search",
    });

    // Use a capable model
    const modelToUse = MODELS.GEMINI_2_5_FLASH_LITE;

    agentLogger.info(`🔍 Starting web search`, {
        query: query.substring(0, 100),
        model: modelToUse,
    });

    const llm = getLLM(modelToUse);
    const response = await generateText({
        model: llm,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: query },
        ],
        tools: {
            webSearchTool: getWebSearchTool({ context }),
            // webPageScrapeTool: getWebsiteContentTool({ context }),
            webPageScrapeTool: getFirecrawlScrapeTool({ context }),

        },
        onStepFinish: (step) => {
            agentLogger.debug(`🤔 Step finished`, {
                reasoning: step.reasoning,
                hasToolCalls: !!step.toolCalls,
                toolCallCount: step.toolCalls?.length ?? 0,
            });
            if (step.toolCalls) {
                agentLogger.debug(`🔧 Tool calls`, {
                    toolCallCount: step.toolCalls.length,
                    toolNames: step.toolCalls.map((tc) => tc.toolName),
                });
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

    agentLogger.debug(`💰 Token usage`, {
        usage: response.usage,
    });

    // Try loading json from the response
    let sources: SourcesType | null = null;
    try {
        sources = parseJson(response.text) as SourcesType | null;
    } catch (error) {
        agentLogger.error("Failed to parse JSON response from web search", {
            error: error instanceof Error ? error.message : String(error),
            responsePreview: response.text.substring(0, 200),
            operation: "webAgent:parseJson",
        });
        // sources remains null, will try alternative parsing below
    }

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

    agentLogger.info(`✅ Web search completed`, {
        query: query.substring(0, 100),
        sourceCount: sources?.sources?.length ?? 0,
        sources: sources?.sources?.map((s) => ({
            url: s.url,
            title: s.title,
            type: s.type,
        })),
    });

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

export const webAgentComplex = async (query: string, context: ToolContext) => {
    const agentLogger = createContextLogger({
        agent: "webAgent",
        phase: "complexSearch",
    });

    const modelToUse = MODELS.GEMINI_2_5_FLASH_LITE;

    agentLogger.info(`🔬 Starting complex web search`, {
        query: query.substring(0, 100),
        model: modelToUse,
    });

    const llm = getLLM(modelToUse);
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
    } catch (error) { }

    if (!subtasks) {
        const res = parseJson(response.text) as { subtasks: string[] };
        if (res) {
            subtasks = res;
        }
    }

    agentLogger.debug(`🤔 Reasoning`, {
        reasoning: response.reasoning,
    });

    if (!subtasks) {
        agentLogger.warn(`⚠️  No subtasks identified`, {
            query: query.substring(0, 100),
            responsePreview: response.text.substring(0, 200),
        });
        return {
            resources: [],
            subtasks: [],
        };
    }

    agentLogger.info(`📋 Subtasks identified`, {
        subtaskCount: subtasks.subtasks.length,
        subtasks: subtasks.subtasks,
    });

    const allResources = (
        await Promise.all(subtasks.subtasks.map((subtask) => webAgent(subtask, context)))
    )
        .map((resource) => resource.sources)
        .flat();

    agentLogger.info(`✅ Complex web search completed`, {
        query: query.substring(0, 100),
        subtaskCount: subtasks.subtasks.length,
        totalResources: allResources.length,
    });

    return {
        resources: allResources,
        subtasks,
    };
};
