import { afterEach } from "vitest";

// Component tests render into document.body; clean up between tests when Testing Library is loaded.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
