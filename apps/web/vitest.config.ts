import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps `jsx: preserve` for Next; tests compile JSX themselves.
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    // Server logic and the theme guard run in node. A component test opts in to the DOM with a
    // `// @vitest-environment jsdom` line at the top of the file.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
