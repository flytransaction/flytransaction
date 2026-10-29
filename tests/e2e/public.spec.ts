import { expect, test } from "@playwright/test";

// These run against `npm run dev` with a Supabase project configured in .env.local (middleware needs the keys).

test("landing page renders with the product name and an example ledger", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ledger");
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
});

test("theme toggle switches to dark mode and the choice persists across reloads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);
  await page.getByTestId("theme-toggle").click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);
});

test("system dark preference is respected on first visit", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("signed-out visitors are redirected away from protected pages", async ({ page }) => {
  for (const path of ["/dashboard", "/settings/profile", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
  }
});

test("login form validates before submitting", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
});

test("signup enforces password strength", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Test User");
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();
});

test("forgot-password gives the same answer for any address (no account enumeration)", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists/)).toBeVisible();
});

test("pricing page shows the monthly and yearly cards", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByText(/Monthly/).first()).toBeVisible();
  await expect(page.getByText(/Yearly/).first()).toBeVisible();
});

test("security headers are present", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("the Stripe webhook rejects unsigned requests", async ({ request }) => {
  const res = await request.post("/api/webhooks/stripe", { data: { id: "evt_fake", type: "invoice.paid", data: { object: {} } } });
  expect(res.status()).toBe(400);
});

test("export endpoints reject signed-out requests", async ({ request }) => {
  const res = await request.get("/api/export/transactions?format=csv");
  expect(res.status()).toBe(401);
});
