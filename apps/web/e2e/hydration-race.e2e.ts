import { expect, test } from "@playwright/test";
import { createUser, TEST_PASSWORD, unique } from "./support/users";

// BUG-005 diagnostic: text typed into the restaurant form before React hydrates it must survive hydration.
// Off by default (it is a repro for a known bug, not a regression gate). Run it against a production build:
//   E2E_HYDRATION_RACE=1 CPU_RATE=6 E2E_BASE_URL=http://localhost:3100 pnpm test:e2e hydration-race --project=desktop

test.describe("hydration race on /create-restaurant", () => {
  test.skip(process.env.E2E_HYDRATION_RACE !== "1", "diagnostic only: set E2E_HYDRATION_RACE=1");

  test("a name typed as soon as the field exists is still there after hydration", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(240_000);
    const email = `${unique("race")}@example.test`;
    await createUser(email);
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForURL(/\/(app|create-restaurant)/, { timeout: 90_000 });

    const rate = Number(process.env.CPU_RATE ?? 6);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });

    const results: string[] = [];
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await page.goto("about:blank");
      await page.goto("/create-restaurant", { waitUntil: "commit" });
      const name = page.locator('input[name="name"]');
      await name.fill("QA Race Restaurant");
      await page.waitForTimeout(5_000); // long enough for hydration at any throttle used here
      results.push(await name.inputValue());
    }
    const lost = results.filter((v) => v !== "QA Race Restaurant").length;
    testInfo.annotations.push({
      type: "result",
      description: `cpu x${rate}, base ${testInfo.project.use.baseURL}: ${lost} of ${results.length} attempts lost the name`,
    });
    expect(
      lost,
      `the name was lost in ${lost} of ${results.length} attempts: ${JSON.stringify(results)}`,
    ).toBe(0);
  });
});
