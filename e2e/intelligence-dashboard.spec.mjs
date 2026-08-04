import { test, expect } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.beforeEach(async ({ page }) => {
  test.skip(!email || !password, "E2E_EMAIL and E2E_PASSWORD are required for the personal-account browser test");
  await page.goto("/login?callbackUrl=%2Fdashboard");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

async function assertNoRuntimeFailures(page, responses, consoleErrors) {
  expect(responses, `unexpected 4xx/5xx responses: ${responses.join("\n")}`).toEqual([]);
  expect(consoleErrors, `browser console errors: ${consoleErrors.join("\n")}`).toEqual([]);
}

test("个人版工作台入口真实点击到情报订制", async ({ page }) => {
  const responses = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.status() >= 400) responses.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const link = page.getByRole("link", { name: "开始订制", exact: true });
  await expect(link).toBeVisible();
  await expect(link).toBeEnabled();
  await expect(link).toHaveAttribute("href", "/data-apps/intelligence-subscriptions");
  await link.click();
  await expect(page).toHaveURL(/\/data-apps\/intelligence-subscriptions$/);
  await expect(page.getByRole("heading", { name: "你想持续关注什么？", exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/playwright-intelligence/after-intelligence-navigation.png", fullPage: true });
  await assertNoRuntimeFailures(page, responses, consoleErrors);
});

test("返回 dashboard 后再次进入仍然有效", async ({ page }) => {
  const responses = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.status() >= 400) responses.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.getByRole("link", { name: "开始订制", exact: true }).click();
  await expect(page).toHaveURL(/\/data-apps\/intelligence-subscriptions$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "开始订制", exact: true }).click();
  await expect(page).toHaveURL(/\/data-apps\/intelligence-subscriptions$/);
  await assertNoRuntimeFailures(page, responses, consoleErrors);
});
