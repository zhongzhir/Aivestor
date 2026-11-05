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

test("个人版工作台入口真实点击到情报工作空间", async ({ page }) => {
  const responses = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.status() >= 400) responses.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const directEntry = page.getByRole("link", { name: "投资情报", exact: true });
  await expect(directEntry).toBeVisible();
  await expect(page.getByRole("link", { name: "进入情报工作空间 →", exact: true })).toBeVisible();
  const link = page.getByRole("link", { name: "管理订制", exact: true }).first();
  await expect(link).toBeVisible();
  await expect(link).toBeEnabled();
  await expect(link).toHaveAttribute("href", "/data-apps/intelligence-subscriptions");
  await link.click();
  await expect(page).toHaveURL(/\/data-apps\/intelligence-subscriptions$/);
  await expect(page.getByRole("heading", { name: "情报工作空间", exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/playwright-intelligence/after-intelligence-navigation.png", fullPage: true });
  await assertNoRuntimeFailures(page, responses, consoleErrors);
});

test("工作台生成后立即进入可见运行状态", async ({ page }) => {
  const generate = page.getByRole("button", { name: /生成本期/ }).first();
  await expect(generate).toBeVisible();
  await generate.click();
  await expect(page).toHaveURL(/\/data-apps\/intelligence-subscriptions\?topic=/);
  await expect(page.getByText(/最近一次：等待运行|最近一次：运行中/)).toBeVisible();
  await expect(page.getByText(/已加入队列|正在研究/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("仅本次允许使用我的 DeepSeek 模型与 Search");
});

test("返回 dashboard 后再次进入仍然有效", async ({ page }) => {
  const responses = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.status() >= 400) responses.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.getByRole("link", { name: "管理订制", exact: true }).first().click();
  await expect(page).toHaveURL(/\/data-apps\/intelligence-subscriptions$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "管理订制", exact: true }).first().click();
  await expect(page).toHaveURL(/\/data-apps\/intelligence-subscriptions$/);
  await assertNoRuntimeFailures(page, responses, consoleErrors);
});
