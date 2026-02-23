import { logger } from "@/utils/logger";
import { TraceExporter } from "@google-cloud/opentelemetry-cloud-trace-exporter";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";

/**
 * OpenTelemetry SDK Configuration
 *
 * This initializes OpenTelemetry with automatic instrumentation for:
 * - HTTP requests (incoming and outgoing)
 * - Fastify framework
 * - Custom spans via TraceManager
 *
 * Supports multiple exporters:
 * - OTLP (Jaeger, Grafana Tempo, Honeycomb, etc.)
 * - Google Cloud Trace
 */

let sdk: NodeSDK | undefined;

function parseOtlpHeaders(rawHeaders: string | undefined): Record<string, string> {
  if (!rawHeaders) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawHeaders) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
          ) {
            acc[key] = String(value);
          }
          return acc;
        },
        {},
      );
    }
  } catch (_error) {
    // Ignore and fall back to "k=v,k2=v2" format
  }

  return rawHeaders
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) {
        return acc;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!key || !value) {
        return acc;
      }

      acc[key] = value;
      return acc;
    }, {});
}

/**
 * Create appropriate trace exporter based on configuration
 */
function createTraceExporter(): SpanExporter {
  const exporterType = process.env.OTEL_EXPORTER_TYPE || "otlp";

  if (exporterType === "google-cloud") {
    // Google Cloud Trace exporter
    logger.info("Using Google Cloud Trace exporter");
    return new TraceExporter({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT,
      // Uses Application Default Credentials (ADC)
      // Set GOOGLE_APPLICATION_CREDENTIALS env var to service account key path
    });
  }
  // Default: OTLP exporter (works with Jaeger, Tempo, Honeycomb, etc.)
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces";
  logger.info("Using OTLP exporter", { endpoint: otlpEndpoint });

  return new OTLPTraceExporter({
    url: otlpEndpoint,
    headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  });
}

function createLogRecordProcessors(): LogRecordProcessor[] {
  const isEnabled = process.env.ENABLE_OPENTELEMETRY_LOGS !== "false";
  if (!isEnabled) {
    logger.info("OpenTelemetry logs export is disabled");
    return [];
  }

  const exporterType = process.env.OTEL_EXPORTER_TYPE || "otlp";
  if (exporterType === "google-cloud") {
    logger.info("OpenTelemetry log export not configured for google-cloud exporter type");
    return [];
  }

  const axiomToken = process.env.AXIOM_TOKEN;
  const axiomDataset = process.env.AXIOM_DATASET;
  const isAxiomConfigured = Boolean(axiomToken && axiomDataset);
  const logEndpoint =
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
    (isAxiomConfigured ? "https://api.axiom.co/v1/logs" : "http://localhost:4318/v1/logs");

  const explicitLogHeaders = parseOtlpHeaders(
    process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS || process.env.OTEL_EXPORTER_OTLP_HEADERS,
  );
  let headers: Record<string, string> = explicitLogHeaders;
  if (Object.keys(headers).length === 0 && axiomToken && axiomDataset) {
    headers = {
      Authorization: `Bearer ${axiomToken}`,
      "x-axiom-dataset": axiomDataset,
    };
  }

  logger.info("Using OTLP logs exporter", {
    endpoint: logEndpoint,
    provider: isAxiomConfigured ? "axiom" : "otlp",
  });

  return [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: logEndpoint,
        headers,
      }),
    ),
  ];
}

/**
 * Initialize OpenTelemetry SDK
 * Should be called once at application startup, before any other imports
 */
export function initializeOpenTelemetry(): NodeSDK | undefined {
  // Check if OpenTelemetry is enabled
  const isEnabled = process.env.ENABLE_OPENTELEMETRY !== "false"; // Enabled by default

  if (!isEnabled) {
    logger.info("OpenTelemetry is disabled");
    return undefined;
  }

  try {
    // Create resource with service information
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "knowsis-ai-backend",
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || "1.0.0",
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || "development",
    });

    // Create appropriate trace exporter
    const traceExporter = createTraceExporter();
    const logRecordProcessors = createLogRecordProcessors();

    // Initialize SDK with instrumentations
    sdk = new NodeSDK({
      resource,
      traceExporter,
      ...(logRecordProcessors.length > 0 ? { logRecordProcessors } : {}),
      instrumentations: [
        // Automatic HTTP instrumentation
        new HttpInstrumentation({
          // Ignore health checks and metrics
          ignoreIncomingRequestHook: (request) => {
            const url = request.url || "";
            return url.includes("/health") || url.includes("/metrics");
          },
          // Add request ID to spans
          requestHook: (span, request) => {
            if (!("headers" in request)) {
              return;
            }
            const requestIdHeader = request.headers["x-request-id"];
            const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
            if (requestId) {
              span.setAttribute("request.id", requestId);
            }
          },
        }),
        // Automatic Fastify instrumentation
        new FastifyInstrumentation({
          // Add route metadata
          requestHook: (span, info) => {
            if (info.request.routeOptions?.url) {
              span.setAttribute("http.route", info.request.routeOptions.url);
            }
          },
        }),
      ],
    });

    sdk.start();

    logger.info("OpenTelemetry initialized successfully", {
      serviceName: resource.attributes[ATTR_SERVICE_NAME],
      environment: resource.attributes[SEMRESATTRS_DEPLOYMENT_ENVIRONMENT],
      exporterType: process.env.OTEL_EXPORTER_TYPE || "otlp",
      logsEnabled: logRecordProcessors.length > 0,
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || "default",
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      try {
        await sdk?.shutdown();
        logger.info("OpenTelemetry SDK shut down successfully");
      } catch (error) {
        logger.error("Error shutting down OpenTelemetry SDK", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return sdk;
  } catch (error) {
    logger.error("Failed to initialize OpenTelemetry", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Get the initialized SDK instance
 */
export function getSDK(): NodeSDK | undefined {
  return sdk;
}

/**
 * Shutdown OpenTelemetry SDK
 */
export async function shutdownOpenTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = undefined;
    logger.info("OpenTelemetry SDK shut down");
  }
}
