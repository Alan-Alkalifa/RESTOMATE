import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  createOrganizationAs,
  createUser,
  insertExpiredInvitation,
  inviteCashierWithToken,
  revokeInvitationAs,
  TEST_PASSWORD,
  unique,
} from "./support/users";

const token = () => randomBytes(32).toString("base64url");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

test("an invitation opened with the wrong account says so, never shows the invited address, and comes back after sign-in", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const owner = `${unique("own")}@example.test`;
  const invited = `${unique("invited")}@example.test`;
  const stranger = `${unique("stranger")}@example.test`;
  const slug = unique("qa-inv");
  const secret = token();
  await createUser(owner);
  await createUser(invited);
  await createUser(stranger);
  await createOrganizationAs(owner, "QA Invite Org", slug);
  await inviteCashierWithToken(owner, slug, invited, secret);
  const link = `/invite/accept?token=${secret}`;

  // Signed in as someone else: Accept, then the mismatch panel.
  await login(page, stranger);
  await page.waitForURL(/\/(app|create-restaurant)/);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: /Join QA Invite Org/ })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    page.getByRole("heading", { name: "You're signed in with a different email" }),
  ).toBeVisible({ timeout: 30_000 });
  const text = await page.locator("body").innerText();
  expect(text.toLowerCase()).not.toContain(invited.toLowerCase());
  expect(text.toLowerCase()).not.toContain(invited.split("@")[0].toLowerCase());

  // Sign out, sign in as the invited address: back on the invitation, and Accept works.
  await page.getByRole("button", { name: "Sign out and use the invited address" }).click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });
  expect(decodeURIComponent(page.url())).toContain(`/invite/accept?token=${secret}`);
  await page.locator('input[name="email"]').fill(invited);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/invite\/accept/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Accept invitation" }).click({ timeout: 60_000 });
  await page.waitForURL(new RegExp(`/app/${slug}`), { timeout: 90_000 });
});

test("every other bad invitation link shows the same generic page", async ({ page }) => {
  test.setTimeout(180_000);
  const owner = `${unique("own")}@example.test`;
  const slug = unique("qa-bad");
  await createUser(owner);
  await createOrganizationAs(owner, "QA Bad Links", slug);

  const revokedToken = token();
  await inviteCashierWithToken(owner, slug, `${unique("rev")}@example.test`, revokedToken);
  await revokeInvitationAs(owner, slug, (await lastInviteeOf(slug, revokedToken)) ?? "");
  const expiredToken = token();
  await insertExpiredInvitation(slug, `${unique("exp")}@example.test`, expiredToken);

  const links: Record<string, string> = {
    "no token": "/invite/accept",
    "malformed token": "/invite/accept?token=not-a-token",
    "unknown token": `/invite/accept?token=${token()}`,
    "revoked token": `/invite/accept?token=${revokedToken}`,
    "expired token": `/invite/accept?token=${expiredToken}`,
  };
  const pages: Record<string, string> = {};
  for (const [name, href] of Object.entries(links)) {
    await page.goto(href);
    await expect(
      page.getByRole("heading", { name: "This invitation link doesn't work" }),
      name,
    ).toBeVisible({ timeout: 60_000 });
    pages[name] = await page.locator("main, body").first().innerText();
  }
  const distinct = new Set(Object.values(pages));
  expect(distinct.size, `the bad links answered differently: ${JSON.stringify(pages)}`).toBe(1);
  expect([...distinct][0]).not.toMatch(/example\.test|QA Bad Links/);
});

// The revoked address is not known to the test after inviteCashierWithToken, so read it back.
async function lastInviteeOf(slug: string, secret: string): Promise<string | undefined> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
  ).toString("hex");
  const res = await fetch(
    `${url}/rest/v1/staff_invitations?token_hash=eq.%5Cx${hash}&select=email`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  const rows = (await res.json()) as Array<{ email: string }>;
  void slug;
  return rows[0]?.email;
}
