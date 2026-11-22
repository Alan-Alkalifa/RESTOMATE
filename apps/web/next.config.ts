import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { assertVercelBuildEnv } from "./lib/env";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default function config(phase: string): NextConfig {
  // `next typegen` also loads the config in the production build phase, so the phase
  // alone can't identify a build. argv[2] is the Next CLI's command. If that ever
  // stops matching, typegen fails loudly and builds are still checked.
  const isTypegen = process.argv[2] === "typegen";
  // Vercel builds only: fail on a bad or missing variable (names only).
  if (phase === PHASE_PRODUCTION_BUILD && !isTypegen) assertVercelBuildEnv();
  return nextConfig;
}
