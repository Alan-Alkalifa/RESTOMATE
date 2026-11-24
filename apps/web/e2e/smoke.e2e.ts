import { expect, test } from "@playwright/test";
import { clearInbox, listMessages } from "./support/mailpit";

// M0-QA-01: proves the harness itself. Real journeys start in M0-QA-04.

test("the marketing page renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  // The hero call to action is a server-rendered link; a crash inside the page would drop it.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('main a[href="/signup"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Mailpit is reachable and can be emptied", async () => {
  test.skip(process.env.E2E_NO_STACK === "1", "needs the local stack");
  await clearInbox();
  expect(await listMessages()).toEqual([]);
});
