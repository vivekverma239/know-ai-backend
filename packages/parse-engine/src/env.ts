/**
 * Centralized environment configuration with validation.
 *
 * Import this module to access validated env vars.
 * Call validateEnv() at startup to fail fast on missing keys.
 * Note: dotenv loading is handled by the CLI entry points (cli.ts, pipeline.ts).
 */

function get(key: string, ...fallbacks: string[]): string | undefined {
  for (const k of [key, ...fallbacks]) {
    const val = process.env[k];
    if (val) return val;
  }
  return undefined;
}

export const env = {
  // Mistral OCR
  get mistralApiKey() { return get("MISTRAL_API_KEY"); },

  // Vercel AI Gateway
  get aiGatewayApiKey() { return get("AI_GATEWAY_API_KEY"); },

  // Google Cloud Storage
  get gcsBucket() { return get("GOOGLE_STORAGE_BUCKET", "GOOGLE_BUCKET_NAME", "google_bucket_name"); },
  get gcsCredentialsRaw() { return get("GOOGLE_APPLICATION_CREDENTIALS_RAW"); },
  get gcsCredentialsBase64() { return get("GOOGLE_APPLICATION_CREDENTIALS_BASE64", "google_application_credentials_base64"); },

  // AWS (Textract)
  get awsAccessKeyId() { return get("AWS_ACCESS_KEY_ID"); },
  get awsSecretAccessKey() { return get("AWS_SECRET_ACCESS_KEY"); },
  get awsRegion() { return get("AWS_REGION_NAME", "aws_region_name") ?? "us-east-1"; },

  // Modal (PaddleOCR)
  get modalEndpointUrl() { return get("MODAL_ENDPOINT_URL"); },

  // Google Gemini (image parser, vision LLM)
  get googleGenerativeAiApiKey() {
    return get("GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY");
  },
};

/**
 * Validate that all required env vars are set for the given pipeline mode.
 * Returns an array of error messages (empty = all good).
 */
export function validateEnv(opts: {
  paddle?: boolean;
  textract?: boolean;
  skipMediaParse?: boolean;
}): string[] {
  const errors: string[] = [];

  if (!env.mistralApiKey) {
    errors.push("MISTRAL_API_KEY not set.");
  }

  if (opts.paddle) {
    if (!env.modalEndpointUrl) {
      errors.push("MODAL_ENDPOINT_URL not set (required for --paddle).");
    }
    if (!env.gcsBucket) {
      errors.push("GOOGLE_STORAGE_BUCKET not set (required for --paddle).");
    }
  }

  if (!opts.skipMediaParse) {
    if (!env.aiGatewayApiKey) {
      errors.push("AI_GATEWAY_API_KEY not set (required for chart/table LLM parsing).");
    }
    if (opts.textract) {
      if (!env.awsAccessKeyId || !env.awsSecretAccessKey) {
        errors.push("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set (required for Textract). Use --no-textract to skip.");
      }
    }
  }

  return errors;
}
