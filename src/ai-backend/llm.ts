import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { MODELS } from "@/@types/llm";
import { initLogger, wrapAISDKModel } from "braintrust";
import { perplexity } from "@ai-sdk/perplexity";

const logger = initLogger({
  projectName: "LaraAI",
  apiKey: process.env.BRAINTRUST_API_KEY,
});

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
});

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const DEFAULT_SMALL_MODEL = MODELS.GEMINI_2_5_FLASH;
export const DEFAULT_LARGE_MODEL = MODELS.GEMINI_2_5_PRO;
export const DEFAULT_REASONING_MODEL = MODELS.O4_MINI;

export function getPerplexityLLM(model: MODELS) {
  return wrapAISDKModel(perplexity(model));
}

export function getLLM(model: MODELS) {
  switch (model) {
    case MODELS.GEMINI_2_0_FLASH:
      return wrapAISDKModel(google("gemini-2.0-flash"));
    case MODELS.GEMINI_1_5_FLASH:
      return wrapAISDKModel(google("gemini-1.5-flash"));
    case MODELS.GEMINI_2_0_FLASH_LITE:
      return wrapAISDKModel(google("gemini-2.0-flash-lite-preview-02-05"));
    case MODELS.GEMINI_2_0_PRO:
      return wrapAISDKModel(google("gemini-2.0-pro-exp-02-05"));
    case MODELS.GEMINI_2_5_FLASH:
      return wrapAISDKModel(google("gemini-2.5-flash"));
    case MODELS.GEMINI_2_5_FLASH_LITE:
      return wrapAISDKModel(google("gemini-2.5-flash-lite-preview-06-17"));
    case MODELS.GEMINI_2_5_PRO:
      return wrapAISDKModel(google("gemini-2.5-pro"));
    case MODELS.DEEPSEEK_LLAMA_8B:
      return wrapAISDKModel(
        openrouter("deepseek/deepseek-r1-distill-llama-8b")
      );
    case MODELS.GLM_4_5:
      return wrapAISDKModel(openrouter("z-ai/glm-4.5"));
    case MODELS.DEEPSEEK_QWEN_2_5_SMALL:
      return wrapAISDKModel(
        openrouter("deepseek/deepseek-r1-distill-qwen-1.5b")
      );
    case MODELS.DEEPSEEK_QWEN_2_5_MEDIUM:
      return wrapAISDKModel(
        openrouter("deepseek/deepseek-r1-distill-qwen-14b")
      );
    case MODELS.DEEPSEEK_QWEN_2_5_LARGE:
      return wrapAISDKModel(
        openrouter("deepseek/deepseek-r1-distill-qwen-32b")
      );
    case MODELS.LLAMA_3_2_11B_VISION_INSTRUCT:
      return wrapAISDKModel(
        openrouter("meta-llama/llama-3.2-11b-vision-instruct")
      );
    case MODELS.LLAMA_3_2_90B_VISION_INSTRUCT:
      return wrapAISDKModel(
        openrouter("meta-llama/llama-3.2-90b-vision-instruct")
      );
    // case MODELS.O4_MINI:
    //   return openai("o4-mini");
    case MODELS.O3_MINI:
      return wrapAISDKModel(openai("o3-mini"));
    case MODELS.O4_MINI:
      return wrapAISDKModel(openai("o4-mini"));
    case MODELS.GPT_4_1:
      return wrapAISDKModel(openai("gpt-4.1"));
    case MODELS.GPT_4_1_MINI:
      return wrapAISDKModel(openai("gpt-4.1-mini"));
    case MODELS.GPT_4o:
      return wrapAISDKModel(openai("gpt-4o"));
    case MODELS.GPT_5:
      return wrapAISDKModel(openai("gpt-5"));
    case MODELS.GPT_5_MINI:
      return wrapAISDKModel(openai("gpt-5-mini"));
    case MODELS.GPT_5_NANO:
      return wrapAISDKModel(openai("gpt-5-nano"));
    case MODELS.CLAUDE_3_5_SONNET:
      return wrapAISDKModel(openrouter("anthropic/claude-3.5-sonnet"));
    case MODELS.CLAUDE_4_SONNET:
      return wrapAISDKModel(openrouter("anthropic/claude-sonnet-4"));
    case MODELS.DEEPSEEK_R1_0528:
      return wrapAISDKModel(openrouter("deepseek/deepseek-r1-0528"));
    case MODELS.DEEPSEEK_V3:
      return wrapAISDKModel(openrouter("deepseek/deepseek-chat-v3-0324"));
    case MODELS.MAGISTRAL_SMALL_2506:
      return wrapAISDKModel(openrouter("mistralai/magistral-small-2506"));
    case MODELS.MAGISTRAL_MEDIUM_2506:
      return wrapAISDKModel(openrouter("mistralai/magistral-medium-2506"));
    case MODELS.MAGISTRAL_MEDIUM_2506_THINKING:
      return wrapAISDKModel(
        openrouter("mistralai/magistral-medium-2506:thinking")
      );
    case MODELS.KIMI_K2:
      return wrapAISDKModel(openrouter("moonshotai/kimi-k2"));
    case MODELS.CLAUDE_4_SONNET:
      return wrapAISDKModel(openrouter("anthropic/claude-4.5-sonnet"));
    case MODELS.GROK_4:
      return wrapAISDKModel(openrouter("x-ai/grok-4"));
    case MODELS.GROK_3_MINI:
      return wrapAISDKModel(openrouter("x-ai/grok-3-mini"));
    case MODELS.OPENAI_GPT_OSS_20B:
      return wrapAISDKModel(openrouter("openai/gpt-oss-20b"));
    case MODELS.PERPLEXITY_SONAR:
      return wrapAISDKModel(perplexity("sonar"));
    case MODELS.OPENAI_GPT_OSS_120B:
      return wrapAISDKModel(openrouter("openai/gpt-oss-120b"));
    case MODELS.SONOMA_DUSK_ALPHA:
      return wrapAISDKModel(openrouter("openrouter/sonoma-dusk-alpha"));
    case MODELS.SONOMA_SKY_ALPHA:
      return wrapAISDKModel(openrouter("openrouter/sonoma-sky-alpha"));
    case MODELS.QWEN_3_NEXT_80B_A3B_THINKING:
      return wrapAISDKModel(openrouter("qwen/qwen3-next-80b-a3b-thinking"));
    case MODELS.GROK_CODE_FAST_1:
      return wrapAISDKModel(openrouter("x-ai/grok-code-fast-1"));
    default:
      throw new Error("Invalid model");
  }
}
