import { expect, test, type Page } from "@playwright/test";
import { unique } from "./support/users";

// Live Arcjet enforcement on a Vercel preview, which runs with the project's own Preview ARCJET_KEY.
// Locally and in CI Arcjet fails open (no key), so only a deployed preview can show a refusal.
// Off by default. Run:
//   E2E_LIVE_SHARE_URL='<preview url with ?_vercel_share=...>' E2E_LIVE_DEPLOYMENT=dpl_... E2E_NO_STACK=1 \
//   E2E_BASE_URL=<preview origin> pnpm test:e2e live-rate-limit --project=desktop
// The share link is a bypass secret for a protected preview: pass it in the environment, never commit it.

const SHARE = process.env.E2E_LIVE_SHARE_URL ?? "";
const ORIGIN = SHARE ? new URL(SHARE).origin : "";

test.describe("live protection on a preview", () => {
  test.skip(!SHARE, "needs E2E_LIVE_SHARE_URL (a preview share link)");
  // Behind an HTTPS-inspecting proxy (a CI or sandbox network) the browser does not trust the proxy CA.
  test.use({ ignoreHTTPSErrors: true });

  // Arcjet's bot rule is live on a preview: an automated browser is refused at the proxy before any page.
  test("bot protection: the default headless browser is refused at the proxy", async ({
    page,
  }, testInfo) => {
    const response = await page.goto(SHARE);
    const body = await page.locator("body").innerText();
    testInfo.annotations.push({
      type: "deployment",
      description: `${process.env.E2E_LIVE_DEPLOYMENT ?? "unknown"}; status ${response?.status()} "${body.trim()}"`,
    });
    expect(response?.status()).toBe(403);
    expect(body.trim()).toBe("Forbidden");
  });

  // The rate-limit tests need the login page. They are not meant to get round the bot rule: when the preview
  // refuses the browser they skip with a reason, and the check is run from a path the owners allow or by hand
  // (docs/qa/M0-signoff.md).
  async function open(page: Page, path: string) {
    await page.goto(SHARE); // sets the protection bypass cookie
    const response = await page.goto(`${ORIGIN}${path}`);
    test.skip(
      response?.status() === 403,
      "the preview refuses this automated browser (Arcjet bot rule), so the rate limit cannot be reached from here",
    );
  }

  test("login: the 6th wrong password for one address in 15 minutes is refused", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const email = `qa-ratelimit-${unique("login")}@example.test`; // does not exist; the limiter counts per address
    await open(page, "/login");
    const outcomes: string[] = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(`wrong-password-${attempt}`);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await page.waitForTimeout(3_500);
      const body = await page.locator("body").innerText();
      outcomes.push(
        /Too many tries/i.test(body)
          ? "refused: too many tries"
          : /email or password is wrong/i.test(body)
            ? "wrong password"
            : "other",
      );
      if (/Too many tries/i.test(body)) break;
    }
    testInfo.annotations.push({
      type: "deployment",
      description: `${process.env.E2E_LIVE_DEPLOYMENT ?? "unknown"}; attempts: ${outcomes.map((o, i) => `${i + 1}=${o}`).join(", ")}`,
    });
    const firstRefusal = outcomes.findIndex((o) => o.startsWith("refused")) + 1;
    expect(firstRefusal, `outcomes: ${JSON.stringify(outcomes)}`).toBe(6);
    expect(
      outcomes.slice(0, 5).every((o) => o === "wrong password"),
      `first five: ${JSON.stringify(outcomes.slice(0, 5))}`,
    ).toBe(true);
  });

  test("slug check: the 31st check by one signed-in user in 10 minutes is refused", async ({
    page,
  }, testInfo) => {
    test.skip(
      !process.env.E2E_LIVE_EMAIL || !process.env.E2E_LIVE_PASSWORD,
      "needs a confirmed account on the preview",
    );
    test.setTimeout(240_000);
    await open(page, "/login");
    await page.locator('input[name="email"]').fill(process.env.E2E_LIVE_EMAIL ?? "");
    await page.locator('input[name="password"]').fill(process.env.E2E_LIVE_PASSWORD ?? "");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForURL(/\/(app|create-restaurant)/, { timeout: 90_000 });
    await page.goto(`${ORIGIN}/create-restaurant`);
    const slugInput = page.locator('input[name="slug"]');
    await expect(slugInput).toBeVisible({ timeout: 60_000 });
    let refusedAt = 0;
    for (let n = 1; n <= 40 && !refusedAt; n += 1) {
      await slugInput.fill(`qa-live-${unique("s")}`.slice(0, 38));
      await page.waitForTimeout(900); // the form debounces its check
      if (/Too many tries/i.test(await page.locator("body").innerText())) refusedAt = n;
    }
    testInfo.annotations.push({
      type: "deployment",
      description: `${process.env.E2E_LIVE_DEPLOYMENT ?? "unknown"}; refused at check ${refusedAt}`,
    });
    expect(refusedAt, "no refusal seen in 40 checks").toBeGreaterThan(0);
  });
});
