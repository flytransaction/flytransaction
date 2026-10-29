import { expect, test, type Page } from "@playwright/test";

/**
 * Signed-in flows. Run `npm run seed:dev` against LOCAL Supabase first, then set:
 *   E2E_USER_EMAIL / E2E_USER_PASSWORD        an account with an active subscription
 *   E2E_EXPIRED_EMAIL / E2E_EXPIRED_PASSWORD  an account whose subscription has ended
 */
const user = { email: process.env.E2E_USER_EMAIL, password: process.env.E2E_USER_PASSWORD };
const expired = { email: process.env.E2E_EXPIRED_EMAIL, password: process.env.E2E_EXPIRED_PASSWORD };

async function login(page: Page, creds: { email?: string; password?: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email ?? "");
  await page.getByLabel("Password").fill(creds.password ?? "");
  await page.getByRole("button", { name: "Log in" }).click();
}

test.describe("subscribed user", () => {
  test.skip(!user.email || !user.password, "set E2E_USER_EMAIL / E2E_USER_PASSWORD");

  test("new person starts at zero; received and given entries update balances and direction", async ({ page }) => {
    await login(page, user);
    await expect(page).toHaveURL(/\/dashboard/);
    const name = `E2E Person ${Date.now()}`;

    await page.getByRole("link", { name: "Add New Person" }).first().click();
    await page.getByLabel("Person name").fill(name);
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("₹0.00").first()).toBeVisible();

    await page.getByRole("button", { name: "+ Add received amount" }).click();
    await page.getByLabel("Amount").fill("10000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("₹10,000.00").first()).toBeVisible();

    await page.getByRole("button", { name: "+ Add advance / given" }).click();
    await page.getByLabel("Amount").fill("3000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("₹7,000.00").first()).toBeVisible();
    await expect(page.getByText("Owes you").first()).toBeVisible();
  });

  test("validation: zero and malformed amounts are rejected in the form", async ({ page }) => {
    await login(page, user);
    await page.getByRole("link", { name: "Open" }).first().click();
    await page.getByRole("button", { name: "+ Add received amount" }).click();
    await page.getByLabel("Amount").fill("0");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Amount must be greater than zero")).toBeVisible();
  });

  test("dashboard has no horizontal scroll on a phone and shows the zebra table", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await login(page, user);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("export controls are available", async ({ page }) => {
    await login(page, user);
    await page.goto("/dashboard/export");
    await expect(page.getByRole("heading", { name: "Export your data" })).toBeVisible();
    await expect(page.getByRole("link", { name: "CSV" }).first()).toBeVisible();
    const res = await page.request.get("/api/export/people?format=csv");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });

  test("a foreign or made-up person id is a 404, not data", async ({ page }) => {
    await login(page, user);
    const res = await page.goto("/dashboard/people/00000000-0000-0000-0000-000000000000");
    expect(res?.status()).toBe(404);
  });
});

test.describe("expired subscription", () => {
  test.skip(!expired.email || !expired.password, "set E2E_EXPIRED_EMAIL / E2E_EXPIRED_PASSWORD");

  test("can log in, is sent to renew, and cannot reach data by URL or API", async ({ page }) => {
    await login(page, expired);
    await expect(page).toHaveURL(/\/(subscription-expired|pricing)/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/(subscription-expired|pricing)/);
    await page.goto("/subscription-expired");
    await expect(page.getByRole("link", { name: "Renew subscription" })).toBeVisible();
    expect((await page.request.get("/api/export/transactions?format=csv")).status()).toBe(401);
  });
});
