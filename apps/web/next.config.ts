import type { NextConfig } from "next";
import { assertVercelBuildEnv } from "./lib/env";

// Vercel builds only: fail on a bad or missing variable (names only).
assertVercelBuildEnv();

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

export default nextConfig;
