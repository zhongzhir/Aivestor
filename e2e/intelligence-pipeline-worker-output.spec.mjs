import { test, expect } from "@playwright/test";

const email = process.env.E2E_WORKER_EMAIL;
const password = process.env.E2E_WORKER_PASSWORD;
const taskId = process.env.E2E_WORKER_TASK_ID;

test("真实 worker 产物经 API 到 UI 保持事实门禁和线索降级", async ({ page }) => {
  test.skip(!email || !password || !taskId, "isolated worker output credentials are required");
  const callback = `/data-apps/intelligence-subscriptions?topic=${taskId}`;
  await page.goto(`/login?callbackUrl=${encodeURIComponent(callback)}`);
  // In dev mode NextAuth and the session provider can issue overlapping
  // bootstrap requests while the route is compiling. Wait until their CSRF
  // cookie writes settle so the credentials callback uses the current token.
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`topic=${taskId}`), { timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "机器人企业资本动态", exact: true })).toBeVisible();
  const apiEvidence = await page.evaluate(async (id) => {
    const response = await fetch(`/api/data-apps/intelligence-subscriptions/${id}/briefs?limit=10`);
    return { status: response.status, body: await response.json() };
  }, taskId);
  expect(apiEvidence.status).toBe(200);
  const clueBriefIndex = apiEvidence.body.briefs.findIndex((brief) => JSON.stringify(brief).includes("宇树科技完成股权转让"));
  expect(clueBriefIndex).toBeGreaterThanOrEqual(0);
  await page.getByRole("tab", { name: "历史", exact: true }).click();
  const history = page.getByRole("heading", { name: "历史简报", exact: true }).locator("xpath=..");
  await history.getByRole("button").nth(clueBriefIndex).click();
  await expect(page.getByRole("heading", { name: "待核实线索", exact: true })).toBeVisible();
  await expect(page.getByText("宇树科技完成股权转让", { exact: true })).toBeVisible();
  await expect(page.getByText("线索", { exact: true })).toBeVisible();
  await expect(page.getByText(/本次基于已核验来源形成 1 条事项/)).toBeVisible();
  await expect(page.getByText(/10亿元|红杉资本|其他融资均不存在/)).toHaveCount(0);

  const zeroItemBriefs = apiEvidence.body.briefs.filter((brief) => brief.item_count === 0);
  // The production-path fixture intentionally creates one insufficient-evidence
  // brief on this topic; a second zero-item brief belongs to a different task
  // and must not leak through the task-scoped history endpoint.
  expect(zeroItemBriefs.length).toBeGreaterThanOrEqual(1);
  for (const brief of zeroItemBriefs) {
    const serialized = JSON.stringify(brief);
    expect(serialized).not.toMatch(/10亿元|红杉资本|其他融资均不存在/);
    expect(brief.metadata.overview).toMatch(/不代表市场上没有/);
  }

  await page.getByRole("tab", { name: "历史", exact: true }).click();
  const zeroItemHistory = page.getByRole("button").filter({ hasText: "0 条事件 · 打开" }).first();
  await expect(zeroItemHistory).toBeVisible();
  await zeroItemHistory.click();
  await expect(page.getByText(/不代表市场上没有/)).toBeVisible();
  await expect(page.getByText(/10亿元|红杉资本|其他融资均不存在/)).toHaveCount(0);
});
