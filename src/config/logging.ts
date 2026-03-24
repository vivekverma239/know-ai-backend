import type { LoggerOptions, TransportMultiOptions, TransportSingleOptions } from "pino";

/**
 * Logging configuration based on environment
 * Development: Pretty-printed console output
 * Production: Structured JSON logs with rotation
 */

const isDevelopment = process.env.NODE_ENV !== "production";
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info");

/**
 * Extended logger options to include transport
 */
interface ExtendedLoggerOptions extends LoggerOptions {
  transport?: TransportSingleOptions | TransportMultiOptions;
}

/**
 * Base logger configuration
 */
export const loggerConfig: ExtendedLoggerOptions = {
  level: logLevel,
  base: {
    service: "knowsis-ai-backend",
    environment: process.env.NODE_ENV || "development",
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => {
      return { level: label };
    },
    bindings: (bindings) => {
      return {
        pid: bindings.pid,
        hostname: bindings.hostname,
      };
    },
  },
};

/**
 * Development transport: Pretty-printed output
 */
if (isDevelopment) {
  loggerConfig.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
      singleLine: false,
      messageFormat: "{levelLabel} - {msg}",
    },
  };
}

/**
 * Production transport: JSON logs
 *
 * For Google Cloud Run/GKE/Compute Engine:
 * - Logs written to stdout/stderr are automatically captured by Google Cloud Logging
 * - No additional configuration needed - just write JSON to stdout
 * - Google Cloud Logging automatically indexes and enriches the logs
 *
 * For other environments:
 * - Can optionally write to files with rotation
 * - Consider using log aggregation services (CloudWatch, Datadog, etc.)
 */
if (!isDevelopment) {
  // Google Cloud mode: Write JSON logs to stdout only
  // Google Cloud Logging automatically captures and indexes these
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT) {
    loggerConfig.transport = {
      target: "pino/file",
      options: {
        destination: 1, // stdout - captured by Google Cloud Logging
      },
    };
  }
  // File-based logging for other environments
  else if (process.env.LOG_FILE) {
    loggerConfig.transport = {
      targets: [
        // Console output (JSON format)
        {
          target: "pino/file",
          level: "info",
          options: {
            destination: 1, // stdout
          },
        },
        // Error logs to separate file
        ...(process.env.LOG_ERROR_FILE
          ? [
              {
                target: "pino/file",
                level: "error",
                options: {
                  destination: process.env.LOG_ERROR_FILE,
                  mkdir: true,
                },
              },
            ]
          : []),
        // All logs to main file (would require pino-roll or similar for rotation)
        {
          target: "pino/file",
          level: logLevel,
          options: {
            destination: process.env.LOG_FILE,
            mkdir: true,
          },
        },
      ],
    };
  }
  // Default production: JSON to stdout
  else {
    loggerConfig.transport = {
      target: "pino/file",
      options: {
        destination: 1, // stdout
      },
    };
  }
}

/**
 * Log rotation configuration (if using pino-roll)
 * This is commented out as pino-roll may need to be installed
 */
export const logRotationConfig = {
  frequency: process.env.LOG_ROTATION_FREQUENCY || "daily", // daily, hourly
  size: process.env.LOG_ROTATION_SIZE || "100m", // 100MB
  maxFiles: Number.parseInt(process.env.LOG_ROTATION_MAX_FILES || "30", 10), // Keep 30 days
};

/**
 * Logging best practices:
 *
 * 1. Use structured logging with metadata:
 *    logger.info("User logged in", { userId, sessionId });
 *
 * 2. Use appropriate log levels:
 *    - debug: Detailed diagnostic information
 *    - info: General informational messages
 *    - warn: Warning messages (degraded performance, potential issues)
 *    - error: Error messages (failures, exceptions)
 *
 * 3. Include correlation IDs (requestId) in all logs
 *
 * 4. Don't log sensitive data (passwords, tokens, PII)
 *
 * 5. Use consistent field names across the application
 *
 * 6. In production, consider using log aggregation services:
 *    - AWS CloudWatch Logs
 *    - Google Cloud Logging
 *    - Datadog
 *    - Elasticsearch + Kibana
 *    - Splunk
 */

export default loggerConfig;
