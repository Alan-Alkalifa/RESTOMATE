import { waitForStack } from "./wait-for-stack";

// Journeys need Auth and Mailpit. The smoke test that only loads a page skips the wait with E2E_NO_STACK=1.
export default async function globalSetup() {
  if (process.env.E2E_NO_STACK === "1") return;
  await waitForStack();
}
