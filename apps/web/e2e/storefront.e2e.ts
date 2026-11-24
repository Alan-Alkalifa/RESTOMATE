import { expect, test } from "@playwright/test";
import { suspendOrganization } from "./support/db";
import { createOrganizationAs, createUser, unique } from "./support/users";

// M0 storefront placeholder at /s/[slug] (the tenant-host rewrite is M4-BE-01).

test("the storefront placeholder shows the restaurant, and a suspended one shows the notice", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const owner = `${unique("shop")}@example.test`;
  const slug = unique("qa-shop");
  await createUser(owner);
  await createOrganizationAs(owner, "QA Corner Cafe", slug);

  await page.goto(`/s/${slug}`);
  await expect(page.getByRole("heading", { name: "QA Corner Cafe" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Online ordering opens soon.")).toBeVisible();

  await page.goto("/s/no-such-restaurant-here");
  await expect(page.getByText("QA Corner Cafe")).toHaveCount(0);

  test.skip(
    !suspendOrganization(slug),
    "needs the local database container to suspend the restaurant",
  );
  await page.goto(`/s/${slug}`);
  await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toBeVisible({
    timeout: 60_000,
  });
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("QA Corner Cafe");
});
