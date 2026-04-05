import { z } from "zod";

const envSchema = z.object({
  // Core
  NODE_ENV: z.string().default("development"),
  ENV: z.string().default("dev"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Auth
  BACKEND_TOKEN: z.string().min(1, "BACKEND_TOKEN is required"),

  // Storage
  GOOGLE_STORAGE_BUCKET: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS_BASE64: z.string().optional(),

  // AI Providers (at least one required)
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  PERPLEXITY_API_KEY: z.string().optional(),

  // QStash
  QSTASH_TOKEN: z.string().optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),
  APP_URL: z.string().optional(),

  // Admin
  ADMIN_USERS_JSON: z.string().optional(),
  ADMIN_SECRETS_FILE: z.string().optional(),
  ADMIN_JWT_SECRET: z.string().optional(),
  ADMIN_CHALLENGE_TTL_MINUTES: z.string().optional(),
  ADMIN_ACCESS_TTL_MINUTES: z.string().optional(),

  // Observability
  ENABLE_OPENTELEMETRY: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_EXPORTER_TYPE: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  SLOW_REQUEST_THRESHOLD_MS: z.string().optional(),

  // External services
  EXA_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  SCRAPER_SERVICE_URL: z.string().optional(),

  // parse-engine (PDF parsing pipeline)
  MISTRAL_API_KEY: z.string().optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION_NAME: z.string().optional(),
  MODAL_ENDPOINT_URL: z.string().optional(),

  // Feature flags
  PERSIST_TOKEN_USAGE: z.string().optional(),
  INGESTION_DEBUG: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
});

let _env: z.infer<typeof envSchema> | null = null;

/** Validate and return env vars. Cached after first call. */
export const getEnv = () => {
  if (_env) return _env;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  _env = parsed.data;
  return _env;
};

// For backwards compatibility — validates on first access
export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_, prop: string) {
    return getEnv()[prop as keyof z.infer<typeof envSchema>];
  },
});
