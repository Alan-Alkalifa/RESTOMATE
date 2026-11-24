import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { setPlan } from "./support/db";
import {
  acceptInvitationAs,
  addLocation,
  createOrganizationAs,
  createUser,
  inviteCashierToLocations,
  locationNamesVisibleTo,
  TEST_PASSWORD,
  unique,
} from "./support/users";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/(app|create-restaurant)/, { timeout: 60_000 });
}

test("4.9.2: a new restaurant has the five built-in roles, and custom roles are locked on the trial plan", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const owner = `${unique("roles")}@example.test`;
  const slug = unique("qa-roles");
  await createUser(owner);
  await createOrganizationAs(owner, "QA Roles Cafe", slug);
  await login(page, owner);

  await page.goto(`/app/${slug}/roles`);
  await expect(page.getByRole("heading", { name: "Roles", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  for (const name of ["Owner", "Manager", "Cashier", "Waiter", "Kitchen"]) {
    await expect(
      page.getByRole("row").filter({ hasText: name }).filter({ hasText: "Built-in" }),
      `built-in role ${name}`,
    ).toBeVisible();
  }
  await expect(page.getByText("Custom roles are locked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create role" }).first()).toBeDisabled();
});

test("4.9.2: on a plan with custom roles an owner builds a role from the permission checklist", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const owner = `${unique("custom")}@example.test`;
  const slug = unique("qa-custom");
  await createUser(owner);
  await createOrganizationAs(owner, "QA Custom Roles", slug);
  // Before the first visit: the app caches the plan per restaurant, and a change made straight in the
  // database (platform plan changes arrive in M1) does not refresh that cache.
  test.skip(!setPlan(slug, "growth"), "needs the local database container to change the plan");
  await login(page, owner);

  await page.goto(`/app/${slug}/roles`);
  await expect(page.getByRole("heading", { name: "Roles", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Custom roles are locked")).toHaveCount(0);
  await page.getByRole("button", { name: "Create role" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Role name").fill("Floor Supervisor");
  const boxes = dialog.getByRole("checkbox");
  await expect(boxes.first()).toBeVisible();
  expect(await boxes.count(), "the permission checklist has entries").toBeGreaterThan(5);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await dialog.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByText("Role created.")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("row").filter({ hasText: "Floor Supervisor" }).filter({ hasText: "Custom" }),
  ).toBeVisible();
});

test("4.9.3: a Cashier limited to one location sees only that location", async ({ page }) => {
  test.setTimeout(180_000);
  const owner = `${unique("locs")}@example.test`;
  const cashier = `${unique("limited")}@example.test`;
  const slug = unique("qa-locs");
  const secret = randomBytes(32).toString("base64url");
  await createUser(owner);
  await createUser(cashier);
  await createOrganizationAs(owner, "QA Two Locations", slug); // location "Main"
  test.skip(!setPlan(slug, "growth"), "needs the local database container to change the plan");
  const second = await addLocation(slug, "Second");
  void second;
  const mainId = (
    (await (
      await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321"}/rest/v1/locations?select=id&name=eq.Main&org_id=eq.${await orgIdOf(slug)}`,
        {
          headers: serviceHeaders(),
        },
      )
    ).json()) as Array<{ id: string }>
  )[0].id;

  await inviteCashierToLocations(owner, slug, cashier, secret, [mainId]);
  await acceptInvitationAs(cashier, secret);

  // The API the app reads through: the Cashier sees Main only; the owner sees both.
  expect(await locationNamesVisibleTo(cashier)).toEqual(["Main"]);
  expect(await locationNamesVisibleTo(owner)).toEqual(["Main", "Second"]);

  // The staff list shows the same limit.
  await login(page, owner);
  await page.goto(`/app/${slug}/staff`);
  const row = page.getByRole("row").filter({ hasText: cashier });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row).toContainText("Main");
  await expect(row).not.toContainText("Second");
});

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return { apikey: key, authorization: `Bearer ${key}` };
}

async function orgIdOf(slug: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const rows = (await (
    await fetch(`${base}/rest/v1/organizations?select=id&slug=eq.${slug}`, {
      headers: serviceHeaders(),
    })
  ).json()) as Array<{ id: string }>;
  return rows[0].id;
}
