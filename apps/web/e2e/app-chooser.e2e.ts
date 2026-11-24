import { expect, test } from "@playwright/test";
import { createOrganizationAs, createUser, TEST_PASSWORD, unique } from "./support/users";

// BUG-001 second case: the "choose a restaurant" screen (account with two or more restaurants).
// It used to throw "Attempted to call buttonClasses() from the server".

test("an account with two restaurants gets a working chooser at /app", async ({ page }) => {
  // The first visit to each route compiles it in `next dev`, which is slow on a cold cache.
  test.setTimeout(120_000);
  const email = `${unique("chooser")}@example.test`;
  const slugs = [unique("qa-one"), unique("qa-two")];
  await createUser(email);
  await createOrganizationAs(email, "QA One", slugs[0]);
  await createOrganizationAs(email, "QA Two", slugs[1]);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  await page.waitForURL(/\/app/);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Choose a restaurant" })).toBeVisible();
  for (const slug of slugs) {
    await expect(page.locator(`a[href="/app/${slug}"]`)).toBeVisible();
  }
  // The "create another restaurant" button is the part that threw.
  await expect(page.getByRole("link", { name: "Create another restaurant" })).toBeVisible();

  await page.locator(`a[href="/app/${slugs[0]}"]`).click();
  await page.waitForURL(`**/app/${slugs[0]}**`, { timeout: 90_000 });
  expect(errors).toEqual([]);
});
