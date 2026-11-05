import { spawn } from "node:child_process";
import { test, expect } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
let worker;

test.beforeAll(async () => {
  test.skip(!email || !password, "E2E_EMAIL and E2E_PASSWORD are required");
  worker = spawn(process.execPath, [
    "-r", "ts-node/register/transpile-only",
    "-r", "tsconfig-paths/register",
    "scripts/run-intelligence-worker.ts",
    "--loop",
    "--idle-ms=1000",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "test", INTELLIGENCE_FIXTURE_MODE: "1", INTELLIGENCE_FIXTURE_SCENARIO: "auto" },
    stdio: ["ignore", "pipe", "pipe"],
  });
});

test.afterAll(async () => {
  if (worker && !worker.killed) worker.kill();
});

test.beforeEach(async ({ page }) => {
  test.skip(!email || !password, "E2E_EMAIL and E2E_PASSWORD are required");
  await page.goto("/login?callbackUrl=%2Fdata-apps%2Fintelligence-subscriptions");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/data-apps\/intelligence-subscriptions$/);
  await expect(page.getByRole("heading", { name: "情报工作空间", exact: true })).toBeVisible();
});

test("真实检索离线回放贯穿证据、简报、运行状态和任务历史", async ({ page }) => {
  await page.goto("/data-apps/intelligence-subscriptions?topic=10000000-0000-4000-8000-000000000004");
  await expect(page.getByRole("heading", { name: "真实检索回放：宇树科技2024年股权融资", exact: true })).toBeVisible();
  await expect(page.getByText("最近一次：部分完成", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 条事件 · 3 个检索候选 · 3 个已取证/)).toBeVisible();
  await expect(page.getByText(/2024年春节前完成B2轮融资，融资额近10亿元/).first()).toBeVisible();
  await expect(page.getByText("事件时间 2024年春节前（未精确到日）", { exact: false })).toBeVisible();
  await expect(page.getByText(/发布日 2024\/9\/24/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("2024/11/1");
  await page.getByText("查看本期检索来源（3）", { exact: true }).click();
  await expect(page.getByText(/Oeeee · 媒体 · 发布于 2024\/9\/24/)).toBeVisible();
  await expect(page.getByText("钛媒体 · 媒体", { exact: false })).toBeVisible();
  await expect(page.getByText("阿里云创新中心 · 门户", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "原文", exact: true })).toHaveCount(3);

  await page.getByRole("tab", { name: "历史", exact: true }).click();
  await expect(page.getByRole("heading", { name: "历史简报", exact: true })).toBeVisible();
  await expect(page.getByText(/1 条事件 · 打开/)).toBeVisible();
  await page.getByText(/1 条事件 · 打开/).click();
  await expect(page.getByText(/2024年春节前完成B2轮融资，融资额近10亿元/).first()).toBeVisible();

  await page.getByRole("tab", { name: "运行记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "运行记录", exact: true })).toBeVisible();
  await expect(page.getByText(/部分完成/).first()).toBeVisible();
  await page.locator("details").first().click();
  await expect(page.getByText(/deepseek-search 成功/)).toBeVisible();
});

test("机器人周报由 scheduler 补跑一次并展示持久成果、历史和来源", async ({ page }) => {
  const row = page.getByRole("heading", { name: "机器人企业资本动态周报", exact: true });
  await expect(row).toBeVisible();
  await row.locator("xpath=ancestor::article").getByRole("button", { name: /查看主题/ }).click();
  await expect(page.getByText("最近一次：完成", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/1 条事件 · 1 个检索候选 · 1 个已取证/)).toBeVisible();
  await expect(page.getByRole("link", { name: "查看证据", exact: true })).toBeVisible();
  await page.getByText("查看本期检索来源（1）", { exact: true }).click();
  await expect(page.getByRole("link", { name: "原文", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "历史", exact: true }).click();
  await expect(page.getByRole("heading", { name: "历史简报", exact: true })).toBeVisible();
  await expect(page.getByText(/1 条事件 · 打开/)).toBeVisible();
  await page.getByRole("tab", { name: "运行记录", exact: true }).click();
  await expect(page.getByText(/catchup/)).toBeVisible();
});

test("文化并购一次性范围经确认后运行、持久化、归档仍保留历史", async ({ page }) => {
  await page.getByRole("button", { name: "新建主题", exact: true }).click();
  await page.getByPlaceholder("例如：收集2026年文化行业并购项目").fill("收集2026年文化行业并购项目");
  await page.getByRole("button", { name: "整理成主题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "请确认系统的理解", exact: true })).toBeVisible();
  const localToday = await page.evaluate(() => new Date().toLocaleDateString("zh-CN"));
  await expect(page.getByText(`2026/1/1 至 ${localToday}`, { exact: false })).toBeVisible();
  await expect(page.getByText("无；本次完成后结束", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认并开始", exact: true }).click();
  await expect(page).toHaveURL(/\?topic=/);
  const topicId = new URL(page.url()).searchParams.get("topic");
  expect(topicId).toBeTruthy();
  await expect(page.getByText("最近一次：完成", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/隔离测试生成 1 条确定性事件/)).toBeVisible();
  await page.getByRole("tab", { name: "历史", exact: true }).click();
  await expect(page.getByText(/1 条事件 · 打开/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await expect(page.getByRole("heading", { name: "情报工作空间", exact: true })).toBeVisible();
  await page.getByText(/已归档主题（1）/).click();
  await expect(page.getByText(/历史简报仍保留；恢复后默认保持暂停/)).toBeVisible();
  await page.getByRole("button", { name: "查看历史", exact: true }).click();
  await expect(page.getByText(/只读查看；请在情报工作空间/)).toBeVisible();
  await expect(page.getByRole("button", { name: "归档", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /情报工作空间/ }).click();
  await page.getByText(/已归档主题（1）/).click();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByText(/历史简报仍保留；恢复后默认保持暂停/)).not.toBeVisible();
  const retained = await page.evaluate(async (id) => {
    const response = await fetch(`/api/data-apps/intelligence-subscriptions/${id}/briefs`);
    return { status: response.status, body: await response.json() };
  }, topicId);
  expect(retained.status).toBe(200);
  expect(retained.body.briefs.length).toBeGreaterThan(0);
});

test("partial 明示覆盖边界，用户A不能读取用户B主题", async ({ page }) => {
  const created = await page.evaluate(async () => {
    const response = await fetch("/api/data-apps/intelligence-subscriptions", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ name: "部分来源测试", topics: ["机器人"], entities: [], keywords: ["融资"], regions: ["中国"], includeRequirements: [], excludeRequirements: [], maxItems: 10, lookbackPeriod: { kind: "days", value: 7 }, outputInstructions: "", executionMode: "manual", scheduleConfig: null, isActive: true, eventTypes: ["融资"] }),
    });
    const body = await response.json();
    const run = await fetch(`/api/data-apps/intelligence-subscriptions/${body.task.id}/generate`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
    return { topicId: body.task.id, runStatus: run.status };
  });
  expect(created.runStatus).toBe(202);
  await page.goto(`/data-apps/intelligence-subscriptions?topic=${created.topicId}`);
  await expect(page.getByText("最近一次：部分完成", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/只代表本次实际检索到的来源集合/).first()).toBeVisible();
  const crossUser = await page.evaluate(async () => (await fetch("/api/data-apps/intelligence-subscriptions/10000000-0000-4000-8000-000000000002")).status);
  expect(crossUser).toBe(404);
  const crossUserMatrix = await page.evaluate(async () => {
    const taskId = "10000000-0000-4000-8000-000000000002";
    const runId = "20000000-0000-4000-8000-000000000002";
    const briefId = "30000000-0000-4000-8000-000000000002";
    const validPatch = { name: "越权", topics: ["私有"], entities: [], keywords: [], regions: [], includeRequirements: [], excludeRequirements: [], maxItems: 10, lookbackPeriod: { kind: "days", value: 7 }, outputInstructions: "", executionMode: "manual", scheduleConfig: null, isActive: true };
    const calls = [
      fetch(`/api/data-apps/intelligence-subscriptions/${taskId}/briefs`),
      fetch(`/api/data-apps/intelligence-subscriptions/${taskId}/runs`),
      fetch(`/api/data-apps/intelligence-subscriptions/${taskId}/runs`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } }),
      fetch(`/api/data-apps/intelligence-subscriptions/${taskId}/generate`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } }),
      fetch(`/api/data-apps/intelligence-subscriptions/runs/${runId}`),
      fetch(`/api/data-apps/intelligence-subscriptions/runs/${runId}`, { method: "POST" }),
      fetch(`/api/data-apps/intelligence-subscriptions/${taskId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(validPatch) }),
      fetch(`/api/data-apps/intelligence-subscriptions/${taskId}`, { method: "DELETE" }),
      fetch(`/api/data-apps/intelligence-subscriptions/${taskId}`, { method: "PUT" }),
      fetch(`/api/data-apps/intelligence-subscriptions/briefs/${briefId}/feedback`),
      fetch(`/api/data-apps/intelligence-subscriptions/briefs/${briefId}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemKey: "private", feedback: "valuable" }) }),
      fetch(`/api/data-apps/intelligence-subscriptions/briefs/${briefId}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }),
      fetch(`/api/data-apps/intelligence-subscriptions/briefs/${briefId}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemKey: "", feedback: "unknown" }) }),
    ];
    return Promise.all(calls.map(async (call) => (await call).status));
  });
  const crossUserCalls = ["briefs", "runs", "enqueue", "generate", "run detail", "run retry", "task patch", "task archive", "task restore", "feedback read", "feedback write", "feedback malformed JSON", "feedback invalid structure"];
  crossUserMatrix.forEach((status, index) => expect(status, crossUserCalls[index]).toBe(404));
});

test("新失败不覆盖旧成功，失败运行可审计", async ({ page }) => {
  const created = await page.evaluate(async () => {
    const taskResponse = await fetch("/api/data-apps/intelligence-subscriptions", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ name: "旧成功保留测试", topics: ["机器人"], entities: [], keywords: ["融资"], regions: ["中国"], includeRequirements: [], excludeRequirements: [], maxItems: 10, lookbackPeriod: { kind: "days", value: 7 }, outputInstructions: "", executionMode: "manual", scheduleConfig: null, isActive: true, eventTypes: ["融资"] }),
    });
    const taskBody = await taskResponse.json();
    if (!taskResponse.ok || !taskBody.task) throw new Error(`create failed ${taskResponse.status}: ${taskBody.error || "missing task"}`);
    const task = taskBody.task;
    await fetch(`/api/data-apps/intelligence-subscriptions/${task.id}/generate`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
    return task.id;
  });
  await page.goto(`/data-apps/intelligence-subscriptions?topic=${created}`);
  await expect(page.getByText("最近一次：完成", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/隔离测试生成 1 条确定性事件/)).toBeVisible();
  await page.evaluate(async (id) => {
    const detail = await (await fetch(`/api/data-apps/intelligence-subscriptions/${id}`)).json();
    const task = detail.task;
    await fetch(`/api/data-apps/intelligence-subscriptions/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "失败测试（保留旧成功）", topics: task.topics, entities: task.entities, keywords: task.keywords, regions: task.regions, includeRequirements: task.include_requirements, excludeRequirements: task.exclude_requirements, maxItems: task.max_items, lookbackPeriod: task.lookback_period, outputInstructions: task.output_instructions, executionMode: task.execution_mode, scheduleConfig: task.schedule_config, isActive: true, eventTypes: task.event_types, sourcePolicy: task.source_policy }),
    });
    await fetch(`/api/data-apps/intelligence-subscriptions/${id}/generate`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
  }, created);
  await page.reload();
  await expect(page.getByText("最近一次：失败", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/下方继续展示最近一次成功成果/)).toBeVisible();
  await expect(page.getByText(/隔离测试生成 1 条确定性事件/)).toBeVisible();
  await page.getByRole("tab", { name: "运行记录", exact: true }).click();
  await expect(page.locator("body")).toContainText("fixture_failed");
  const retryPublic = await page.evaluate(async (taskId) => {
    const runs = await (await fetch(`/api/data-apps/intelligence-subscriptions/${taskId}/runs`)).json();
    const failed = runs.runs.find((run) => run.status === "failed");
    const response = await fetch(`/api/data-apps/intelligence-subscriptions/runs/${failed.id}`, { method: "POST" });
    const body = await response.json();
    return {
      status: response.status,
      hasHistory: body.run.attempt_history.length > 0,
      sanitized: !("locked_by" in body.run) && body.run.attempt_history.every((entry) => !("worker" in entry)),
    };
  }, created);
  expect(retryPublic).toEqual({ status: 202, hasHistory: true, sanitized: true });
});

test("窄屏、平板和200%等效缩放保持主动作与键盘可达", async ({ page }) => {
  for (const viewport of [{ width: 375, height: 780 }, { width: 768, height: 900 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/data-apps/intelligence-subscriptions");
    await expect(page.getByRole("button", { name: "新建主题", exact: true })).toBeVisible();
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 780,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await page.goto("/data-apps/intelligence-subscriptions");
  expect(await page.evaluate(() => ({ width: innerWidth, scale: devicePixelRatio }))).toEqual({ width: 375, scale: 2 });
  await expect(page.getByRole("button", { name: "新建主题", exact: true })).toBeVisible();

  const sidebar = page.locator('aside[aria-label="主导航"]');
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => sidebar.evaluate((element) => element.inert)).toBe(true);
  const expectedClosedTabOrder = await page.evaluate(() => {
    const selector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll(selector))
      .filter((element) => {
        if (!(element instanceof HTMLElement) || element.closest("aside") || element.closest("[inert]")) return false;
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
      })
      .map((element) => ({
        tag: element.tagName,
        ariaLabel: element.getAttribute("aria-label"),
        href: element.getAttribute("href"),
        placeholder: element.getAttribute("placeholder"),
        text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || null,
        inSidebar: Boolean(element.closest("aside")),
      }));
  });
  expect(expectedClosedTabOrder.length).toBeGreaterThan(5);
  await page.evaluate(() => document.activeElement?.blur());
  const closedTabOrder = [];
  for (let index = 0; index < expectedClosedTabOrder.length; index += 1) {
    await page.keyboard.press("Tab");
    closedTabOrder.push(await page.evaluate(() => ({
      tag: document.activeElement?.tagName || null,
      ariaLabel: document.activeElement?.getAttribute("aria-label") || null,
      href: document.activeElement?.getAttribute("href") || null,
      placeholder: document.activeElement?.getAttribute("placeholder") || null,
      text: document.activeElement?.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || null,
      inSidebar: Boolean(document.activeElement?.closest("aside")),
    })));
  }
  expect(closedTabOrder).toEqual(expectedClosedTabOrder);
  expect(closedTabOrder[0].ariaLabel).toBe("打开导航菜单");

  const menuButton = page.getByRole("button", { name: "打开导航菜单" });
  await menuButton.click();
  await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => sidebar.evaluate((element) => element.inert)).toBe(false);
  await expect(sidebar.getByRole("link", { name: /Aivestor/i })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(sidebar.getByRole("link", { name: "工作台 今日关注", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menuButton).toBeFocused();
  await expect.poll(() => sidebar.evaluate((element) => element.inert)).toBe(true);

  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/data-apps/intelligence-subscriptions");
  await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => sidebar.evaluate((element) => element.inert)).toBe(false);
  await sidebar.getByRole("link", { name: /Aivestor/i }).focus();
  await page.keyboard.press("Tab");
  await expect(sidebar.getByRole("link", { name: "工作台 今日关注", exact: true })).toBeFocused();
});

test("旧客户端不带创建幂等键仍兼容并收到服务端请求键", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/data-apps/intelligence-subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "旧客户端兼容测试", topics: ["并购"], entities: [], keywords: [], regions: ["中国"], includeRequirements: [], excludeRequirements: [], maxItems: 10, lookbackPeriod: { kind: "days", value: 7 }, outputInstructions: "", executionMode: "manual", scheduleConfig: null, isActive: false, eventTypes: ["并购"] }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(result.status).toBe(201);
  expect(result.body.task.id).toBeTruthy();
  expect(result.body.createRequestKey).toMatch(/^[0-9a-f-]{36}$/i);
  await page.evaluate(async (id) => { await fetch(`/api/data-apps/intelligence-subscriptions/${id}`, { method: "DELETE" }); }, result.body.task.id);
});

test("编辑未来配置保留多工作日与旧快照，今天日期不漂移", async ({ page }) => {
  const created = await page.evaluate(async () => {
    const workspace = await (await fetch("/api/data-apps/intelligence-subscriptions")).json();
    for (const task of workspace.tasks ?? []) {
      if (["部分来源测试", "失败测试（保留旧成功）"].includes(task.name)) {
        await fetch(`/api/data-apps/intelligence-subscriptions/${task.id}`, { method: "DELETE" });
      }
    }
    const key = crypto.randomUUID();
    const payload = { name: "配置快照工作日测试", topics: ["机器人"], entities: [], keywords: ["融资"], regions: ["中国"], includeRequirements: [], excludeRequirements: [], maxItems: 10, lookbackPeriod: { kind: "custom", start: "2026-01-01T00:00:00.000Z", end: new Date().toISOString() }, outputInstructions: "", executionMode: "scheduled", scheduleConfig: { frequency: "weekly", weekdays: [1, 2, 3, 4, 5], time: "08:00", timezone: "Asia/Shanghai" }, isActive: true, eventTypes: ["融资"] };
    const first = await fetch("/api/data-apps/intelligence-subscriptions", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(payload) });
    const firstBody = await first.json();
    if (!first.ok) throw new Error(firstBody.error || `create failed ${first.status}`);
    const recovered = await fetch("/api/data-apps/intelligence-subscriptions", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(payload) });
    const recoveredBody = await recovered.json();
    const runRequestKey = crypto.randomUUID();
    const runResponse = await fetch(`/api/data-apps/intelligence-subscriptions/${firstBody.task.id}/generate`, { method: "POST", headers: { "idempotency-key": runRequestKey } });
    const runBody = await runResponse.json();
    return {
      topicId: firstBody.task.id,
      recoveredId: recoveredBody.task.id,
      recovered: recoveredBody.recovered,
      runId: runBody.run.id,
      runRequestKey,
      postRunPublic: !("locked_by" in runBody.run) && runBody.run.attempt_history.every((entry) => !("worker" in entry)),
    };
  });
  expect(created.recoveredId).toBe(created.topicId);
  expect(created.recovered).toBe(true);
  expect(created.postRunPublic).toBe(true);
  await page.goto(`/data-apps/intelligence-subscriptions?topic=${created.topicId}`);
  await expect(page.getByText("最近一次：完成", { exact: true })).toBeVisible({ timeout: 30_000 });
  const repeatedPostsPublic = await page.evaluate(async ({ topicId, runRequestKey }) => {
    const responses = await Promise.all([
      fetch(`/api/data-apps/intelligence-subscriptions/${topicId}/generate`, { method: "POST", headers: { "idempotency-key": runRequestKey } }),
      fetch(`/api/data-apps/intelligence-subscriptions/${topicId}/runs`, { method: "POST", headers: { "idempotency-key": runRequestKey } }),
    ]);
    return Promise.all(responses.map(async (response) => {
      const body = await response.json();
      return {
        status: response.status,
        hasHistory: body.run.attempt_history.length > 0,
        sanitized: !("locked_by" in body.run) && body.run.attempt_history.every((entry) => !("worker" in entry)),
      };
    }));
  }, created);
  expect(repeatedPostsPublic).toEqual([
    { status: 202, hasHistory: true, sanitized: true },
    { status: 202, hasHistory: true, sanitized: true },
  ]);
  await page.getByRole("tab", { name: "范围与计划", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("事件类型").fill("并购");
  await page.getByRole("button", { name: "保存未来设置", exact: true }).click();
  await expect(page.getByText("并购", { exact: true })).toBeVisible();
  const state = await page.evaluate(async ({ topicId, runId }) => {
    const task = (await (await fetch(`/api/data-apps/intelligence-subscriptions/${topicId}`)).json()).task;
    const run = (await (await fetch(`/api/data-apps/intelligence-subscriptions/runs/${runId}`)).json()).run;
    return { task, run };
  }, created);
  expect(state.task.schedule_config.weekdays).toEqual([1, 2, 3, 4, 5]);
  expect(state.task.event_types).toEqual(["并购"]);
  expect(new Date(state.task.lookback_period.end).getTime()).toBeLessThanOrEqual(Date.now() + 2_000);
  expect(state.run.config_snapshot.eventTypes).toEqual(["融资"]);
  expect(state.run.config_snapshot.scheduleConfig.weekdays).toEqual([1, 2, 3, 4, 5]);
  expect(state.run.config_version).toBeLessThan(state.task.config_version);
  expect(state.run.attempt_history.every((entry) => !("worker" in entry))).toBe(true);
});
