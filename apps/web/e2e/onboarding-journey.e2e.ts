import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { findLink, waitForMailWith } from "./support/mailpit";
import { readSession } from "./support/session";
import { inviteCashierWithToken, TEST_PASSWORD, unique } from "./support/users";

// M0-QA-04: the M0 exit, through the real screens and the real mail (Mailpit).
// Signup -> confirm -> create restaurant -> invite a Cashier -> accept -> deactivate.

test("owner signs up, creates a restaurant, invites a Cashier who accepts and is then deactivated", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = `${unique("owner")}@example.test`;
  const invitedByUi = `${unique("invited")}@example.test`;
  const cashier = `${unique("cashier")}@example.test`;
  // The same shape the app issues: 32 random bytes, base64url, 43 characters.
  const inviteToken = randomBytes(32).toString("base64url");
  const slug = unique("qa-e2e");

  // 1. Signup and confirm through the mail.
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("QA Owner");
  await page.getByLabel("Email").fill(owner);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const confirmMail = await waitForMailWith(owner, "/auth/confirm");
  await page.goto(findLink(confirmMail.html + confirmMail.text, "/auth/confirm"));

  // 2. Signed in: a new account has no restaurant, so it lands on the setup screen.
  await expect(page.getByRole("heading", { name: "Set up your restaurant" })).toBeVisible({
    timeout: 60_000,
  });
  // The slug check only answers once the form is hydrated: wait for it before typing the name, or a
  // late hydration in `next dev` clears what was typed.
  const slugInput = page.locator('input[name="slug"]');
  const nameInput = page.locator('input[name="name"]');
  await expect(async () => {
    await slugInput.fill(slug);
    await expect(page.getByText(/available/i).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await expect(async () => {
    await nameInput.fill("QA E2E Restaurant");
    await expect(nameInput).toHaveValue("QA E2E Restaurant");
    await expect(slugInput).toHaveValue(slug);
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Create restaurant" }).click();
  await page.waitForURL(new RegExp(`/app/${slug}`), { timeout: 90_000 });

  // 3. Invite a Cashier.
  await page.goto(`/app/${slug}/staff`);
  await expect(page.getByRole("heading", { name: "Staff", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Invite staff" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").first().fill(invitedByUi);
  await dialog.getByRole("combobox").selectOption({ label: "Cashier" });
  await dialog.getByLabel("All locations").check();
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible({ timeout: 30_000 });
  // The invitation is listed as pending. (The app's own email body is not readable locally: with
  // EMAIL_DELIVERY=log only a metadata line is logged, so acceptance below uses a known token.)
  await page.getByRole("tab", { name: /Invitations/ }).click();
  const pending = page.getByRole("row").filter({ hasText: invitedByUi });
  await expect(pending).toBeVisible();
  await expect(pending.getByText("Pending")).toBeVisible();
  await inviteCashierWithToken(owner, slug, cashier, inviteToken);

  // 4. The Cashier opens the mailed link in a separate browser, signs up with that address and accepts.
  const inviteLink = new URL(
    `/invite/accept?token=${encodeURIComponent(inviteToken)}`,
    page.url(),
  ).toString();
  const cashierContext = await browser.newContext(test.info().project.use);
  const cashierPage = await cashierContext.newPage();
  await cashierPage.goto(inviteLink);
  await expect(cashierPage.getByRole("heading", { name: /Join QA E2E Restaurant/ })).toBeVisible();
  await expect(cashierPage.getByText("You're invited as Cashier.")).toBeVisible();
  await cashierPage.getByRole("link", { name: "Create an account" }).click();
  await cashierPage.getByLabel("Email").fill(cashier);
  await cashierPage.locator('input[name="password"]').fill(TEST_PASSWORD);
  await cashierPage.getByRole("button", { name: "Create account" }).click();
  await expect(cashierPage.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const cashierConfirm = await waitForMailWith(cashier, "/auth/confirm");
  await cashierPage.goto(findLink(cashierConfirm.html + cashierConfirm.text, "/auth/confirm"));
  await cashierPage.getByRole("button", { name: "Accept invitation" }).click({ timeout: 60_000 });
  await cashierPage.waitForURL(new RegExp(`/app/${slug}`), { timeout: 90_000 });

  // What the Cashier's browser holds while still a member.
  const before = await readSession(cashierContext);

  // 5. The owner sees the new member, deactivates them, and the Cashier is signed out.
  await page.goto(`/app/${slug}/staff`);
  const row = page.getByRole("row").filter({ hasText: cashier });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "Deactivate" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("Team member deactivated.")).toBeVisible({ timeout: 30_000 });

  // 4.9.6 "signed out everywhere", from the Cashier's side:
  // a) the restaurant no longer opens (membership is checked on every request);
  await cashierPage.goto(`/app/${slug}`);
  await expect(cashierPage.getByRole("heading", { name: "Your access was removed" })).toBeVisible({
    timeout: 30_000,
  });
  // b) the server session is gone: the refresh token cannot get a new access token;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  const refresh = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: before.refresh_token }),
  });
  expect(refresh.ok, "a revoked session must not refresh").toBe(false);
  // c) and the access token already issued reads none of the restaurant's data.
  const locations = await fetch(`${supabaseUrl}/rest/v1/locations?select=id`, {
    headers: { apikey: anon, authorization: `Bearer ${before.access_token}` },
  });
  expect(await locations.json()).toEqual([]);
  await cashierContext.close();
});
