import { assertBootEnv } from "./lib/env";

/** A production instance refuses to start on a bad environment (names only, never values). */
export function register() {
  // `next build` also loads this file; the build is checked in next.config.ts (Vercel only).
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  assertBootEnv();
}
