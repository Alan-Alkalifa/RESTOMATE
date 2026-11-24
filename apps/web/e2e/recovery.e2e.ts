import { expect, test } from "@playwright/test";
import { findLink, waitForMailWith } from "./support/mailpit";
import { canSignIn, createUser, TEST_PASSWORD, unique } from "./support/users";

// Password recovery through the real mail: /forgot-password, Mailpit, /auth/confirm, /reset-password.

test("a forgotten password is reset through the mailed link and the new password works", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const email = `${unique("recover")}@example.test`;
  const fresh = "Qa-New-Passw0rd!7";
  await createUser(email);

  await page.goto("/forgot-password");
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
    timeout: 60_000,
  });

  const mail = await waitForMailWith(email, "/auth/confirm");
  const link = findLink(mail.html + mail.text, "/auth/confirm");
  expect(link).toContain("token_hash=");
  expect(link).toContain("type=recovery");
  expect(mail.subject).toContain("Reset your password");

  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible({
    timeout: 60_000,
  });
  await page.locator('input[name="password"]').fill(fresh);
  await page.locator('input[name="confirmPassword"]').fill(fresh);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).not.toHaveURL(/reset-password/, { timeout: 60_000 });

  expect(await canSignIn(email, fresh), "the new password works").toBe(true);
  expect(await canSignIn(email, TEST_PASSWORD), "the old password no longer works").toBe(false);
});
