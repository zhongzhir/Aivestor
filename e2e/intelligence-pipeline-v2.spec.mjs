import { test, expect } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test("确定性流水线在主题页展示阶段、旧成果和历史入口", async ({ page }) => {
  test.skip(!email || !password, "isolated E2E credentials are required");
  await page.goto("/login?callbackUrl=%2Fdata-apps%2Fintelligence-subscriptions%3Ftopic%3D90000000-0000-4000-8000-000000000101");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/topic=90000000-0000-4000-8000-000000000101/);
  await expect(page.getByRole("heading", { name: "流水线同源多事件验收", exact: true })).toBeVisible();
  await expect(page.getByText("最近一次：运行中", { exact: true })).toBeVisible();
  await expect(page.getByText("当前阶段：核验正文", { exact: true })).toBeVisible();
  await expect(page.getByText(/宇树科技完成 B2 轮融资/).first()).toBeVisible();
  await expect(page.getByText(/宇树科技完成 C 轮融资/).first()).toBeVisible();
  await expect(page.getByText("2 条事件 · 1 个检索候选 · 1 个已取证", { exact: true })).toBeVisible();
  const sourceDetails = page.locator("details").filter({ hasText: "查看本期检索来源（1）" });
  await sourceDetails.locator("summary").click();
  await expect(sourceDetails.getByText(/全文核验/)).toBeVisible();
  const sameSourceBrief = await page.evaluate(async () => {
    const response = await fetch("/api/data-apps/intelligence-subscriptions/90000000-0000-4000-8000-000000000101/briefs?limit=10");
    const body = await response.json();
    const brief = body.briefs.find((candidate) => candidate.id === "90000000-0000-4000-8000-000000000301");
    const items = [...(brief?.important_facts || []), ...(brief?.other_items || [])];
    return {
      status: response.status,
      itemCount: brief?.item_count,
      itemIds: items.map((item) => item.id),
      sourceUrls: [...new Set(items.flatMap((item) => item.sourceUrls || [item.sourceUrl]).filter(Boolean))],
    };
  });
  expect(sameSourceBrief).toEqual({
    status: 200,
    itemCount: 2,
    itemIds: ["pipeline:unitree-b2", "pipeline:unitree-c"],
    sourceUrls: ["https://example.com/unitree-financing-rounds"],
  });

  await page.getByRole("tab", { name: "历史", exact: true }).click();
  await expect(page.getByRole("heading", { name: "历史简报", exact: true })).toBeVisible();
  await expect(page.getByText(/2 条事件 · 打开/)).toBeVisible();

  await page.getByRole("tab", { name: "运行记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "运行记录", exact: true })).toBeVisible();
  const running = page.locator("details").first();
  await running.locator("summary").click();
  await expect(running.getByText(/流水线阶段：核验正文 · running/)).toBeVisible();
  const freshAuthorizationRequired = page.locator("details").filter({ hasText: "单次费用授权已经结束" });
  await freshAuthorizationRequired.locator("summary").click();
  await expect(freshAuthorizationRequired.getByText(/重新勾选 DeepSeek 单次授权/)).toBeVisible();
  await expect(freshAuthorizationRequired.getByRole("button", { name: "重试同一运行" })).toHaveCount(0);
  const directRetry = await page.evaluate(async () => {
    const response = await fetch("/api/data-apps/intelligence-subscriptions/runs/90000000-0000-4000-8000-000000000203", { method: "POST" });
    return { status: response.status, body: await response.json() };
  });
  expect(directRetry.status).toBe(409);
  expect(directRetry.body.code).toBe("fresh_external_authorization_required");
  await page.screenshot({ path: "artifacts/playwright-intelligence/pipeline-v2-topic.png", fullPage: true });

  await page.setViewportSize({ width: 375, height: 780 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 780, deviceScaleFactor: 2, mobile: false });
  await page.goto("/data-apps/intelligence-subscriptions?topic=90000000-0000-4000-8000-000000000101");
  await expect(page.getByText("当前阶段：核验正文", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "历史", exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth }))).toEqual({ width: 375, overflow: 0 });
});
