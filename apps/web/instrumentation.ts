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
}
