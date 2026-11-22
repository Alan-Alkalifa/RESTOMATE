import type { Instrumentation } from "next";

import { assertBootEnv } from "./lib/env";

/**
 * Fails a production instance's startup on a bad environment (names only, never values).
 * Next does not exit: the process stays up and answers 500, except for static files.
 */
export function register() {
  // `next build` also loads this file; the build is checked in next.config.ts (Vercel only).
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  assertBootEnv();
  void import("./lib/analytics/logs")
    .then(({ logServerInstrumentationReady }) => {
      logServerInstrumentationReady();
    })
    .catch(() => undefined);
}

/** Reports server errors. `request` is not read: its path and headers carry tokens. */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const [{ captureServerError }, { logServerRequestError }] = await Promise.all([
        import("./lib/analytics/server"),
        import("./lib/analytics/logs"),
      ]);
      captureServerError(error, { source: context.routeType, route: context.routePath });
      logServerRequestError(context.routeType, context.routePath);
    } catch {
      // Error tracking never adds an error of its own.
    }
  }
};
