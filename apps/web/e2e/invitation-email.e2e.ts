import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { renderInvitationEmail } from "../lib/email/templates/invitation";

// 4.9.1 evidence for the themed, bilingual staff invitation email. The app's own mail cannot be read locally
// (EMAIL_DELIVERY=log records no body or link), so the real renderer is run with sample values, opened in a
// browser and checked. Set QA_EVIDENCE=1 to also write the HTML and the screenshots to docs/qa/evidence/.

const EVIDENCE = "../../docs/qa/evidence/invitation-email";
const ORG = `Warung "Sedap" <Rasa> & Co`; // needs escaping everywhere it appears
const ROLE = "Cashier";

/** The link the app puts in the email: its own URL, the accept path and the token (lib/actions/staff/email.ts). */
async function expectedLink(token: string): Promise<{ link: string; source: string }> {
  try {
    const { acceptInvitationUrl } = await import("../lib/actions/staff/email");
    return { link: acceptInvitationUrl(token), source: "acceptInvitationUrl()" };
  } catch {
    // The module is `server-only` and cannot be imported outside the framework: rebuild it the same way.
    const url = new URL(
      "/invite/accept",
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    );
    url.searchParams.set("token", token);
    return { link: url.toString(), source: "the same construction (the module is server-only)" };
  }
}

async function clipOf(page: Page, lang: "en" | "id") {
  return page.evaluate((l) => {
    const rects = [...document.querySelectorAll(`[lang="${l}"]`)].map((el) =>
      el.getBoundingClientRect(),
    );
    const top = Math.min(...rects.map((r) => r.top)) + window.scrollY - 24;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + window.scrollY + 24;
    return {
      x: 0,
      y: Math.max(0, top),
      width: window.innerWidth,
      height: bottom - Math.max(0, top),
    };
  }, lang);
}

test("the invitation email is themed, bilingual, escaped and links to the accept page", async ({
  page,
}, testInfo) => {
  const token = randomBytes(32).toString("base64url");
  const { link, source } = await expectedLink(token);
  const mail = renderInvitationEmail({ orgName: ORG, roleName: ROLE, acceptUrl: link });
  testInfo.annotations.push({ type: "link source", description: source });

  // Subject and text part: both languages, the link, no markup.
  expect(mail.subject).toContain("You're invited to");
  expect(mail.subject).toContain("Anda diundang ke");
  expect(mail.text).toContain(link);
  expect(mail.text).toContain("Accept:");
  expect(mail.text).toContain("Terima:");
  expect(mail.text).toContain(ORG); // plain text: the name as typed

  const evidence = process.env.QA_EVIDENCE === "1";
  if (evidence) {
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(`${EVIDENCE}/invitation-email.html`, mail.html);
    writeFileSync(`${EVIDENCE}/invitation-email.txt`, `Subject: ${mail.subject}\n\n${mail.text}\n`);
  }

  for (const [name, size] of [
    ["mobile", { width: 390, height: 844 }],
    ["desktop", { width: 1280, height: 900 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.setContent(mail.html);

    // Markup: the org name appears as text, never as elements; the button goes to the accept page.
    await expect(page.locator("script, img")).toHaveCount(0);
    await expect(page.locator('h1[lang="en"]')).toHaveText(`You're invited to ${ORG}`);
    await expect(page.locator('h2[lang="id"]')).toHaveText(`Anda diundang ke ${ORG}`);
    await expect(page.locator('p[lang="en"]').first()).toContainText(`join ${ORG} as ${ROLE}`);
    await expect(page.locator('p[lang="id"]').first()).toContainText(
      `dengan ${ORG} sebagai ${ROLE}`,
    );
    const button = page.getByRole("link", { name: /accept|terima/i }).first();
    await expect(button).toHaveAttribute("href", link);
    const href = new URL((await button.getAttribute("href")) ?? "");
    expect(href.pathname).toBe("/invite/accept");
    expect(href.searchParams.get("token")).toBe(token);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `${name}: no horizontal scroll`,
    ).toBe(true);

    if (evidence) {
      await page.screenshot({ path: `${EVIDENCE}/${name}-full.png`, fullPage: true });
      for (const lang of ["en", "id"] as const) {
        await page.screenshot({
          path: `${EVIDENCE}/${name}-${lang}.png`,
          fullPage: true,
          clip: await clipOf(page, lang),
        });
      }
    }
  }
});
