import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

import { getAnalyticsConfig } from "./config";

/**
 * This provider is intentionally separate from global OTel logging: only records emitted
 * through this module leave the application for PostHog.
 */
let loggerProvider: LoggerProvider | undefined;

function getLogger() {
  if (loggerProvider) return loggerProvider.getLogger("restomate.posthog");
  if (process.env.NEXT_PHASE === "phase-production-build") return undefined;

  const config = getAnalyticsConfig();
  if (!config) return undefined;

  loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      "service.name": "restomate-web",
      "deployment.environment": process.env.NODE_ENV ?? "unknown",
    }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${config.host}/i/v1/logs`,
          headers: {
            Authorization: `Bearer ${config.key}`,
            "Content-Type": "application/json",
          },
        }),
      }),
    ],
  });

  return loggerProvider.getLogger("restomate.posthog");
}

/** Emits a small, structured lifecycle record without request bodies, secrets, or user data. */
export function logServerInstrumentationReady(): void {
  try {
    getLogger()?.emit({
      body: "server instrumentation ready",
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      attributes: { event: "server_instrumentation_ready" },
    });
  } catch {
    // Log export never blocks application startup.
  }
}

/** Records that Next delegated a server error to the existing error-reporting path. */
export function logServerRequestError(source: string, route?: string): void {
  try {
    getLogger()?.emit({
      body: "server request error reported",
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      attributes: {
        event: "server_request_error_reported",
        source,
        ...(route && { route }),
      },
    });
  } catch {
    // Log export never affects error handling.
  }
}

