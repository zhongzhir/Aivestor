// P5 验收冒烟测试（架构文档 v1.1 第五部分 A6）。
//
// 跑通：FixtureZjjrClient 读 sample.json → 清洗→消歧→特征提取→向量化→双轨写入到本地 DB
//   → 校验 zjjr_features 有数据 → 模拟 knowledgeSearch 的 zjjr 路直接查表能命中。
//
// 前置：
//   1. 迁移 028 已在本地 DB 执行（含 pg_trgm 扩展）。
//   2. 设置 DATABASE_URL（或 ZJJR_SYNC_DATABASE_URL）指向本地库。
//   3. 可选 BAILIAN_API_KEY：配置则走真实向量化，未配置则降级（仍可全文检索验证）。
//
// 运行：
//   cd services/zjjr-sync
//   npm install
//   $env:DATABASE_URL="postgres://...localdb"; npx ts-node scripts/smoke-test.ts

import { FixtureZjjrClient } from "../src/client";
import { runPipeline } from "../src/sync-core";
import { query, pool } from "../src/db";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-test] 断言失败：${msg}`);
}

async function main(): Promise<void> {
  let failed = false;
  try {
    // 1. Fixture 读取。
    const client = new FixtureZjjrClient();
    assert(await client.healthCheck(), "FixtureZjjrClient.healthCheck 应为 true");
    const insts = await client.fetchInstitutions({});
    const invs = await client.fetchInvestments({});
    console.log(
      `[smoke-test] 1. Fixture 读取：机构 ${insts.items.length} / 投资 ${invs.items.length}`
    );
    assert(insts.items.length >= 5, "样本机构应 >= 5 条");

    // 2. 全流水线（清洗→消歧→特征→向量→双轨写入）。
    const result = await runPipeline(insts.items, invs.items);
    console.log(
      `[smoke-test] 2. 流水线：机构 ${result.institutions} / 投资 ${result.investments} / ` +
        `特征 ${result.features}（向量化 ${result.embedded ? "已生成" : "降级纯文本"}，` +
        `pending_merge ${result.pendingMerges}）`
    );
    assert(result.institutions >= 5, "应写入 >= 5 家机构");
    assert(result.features > 0, "应生成特征");

    // 3. zjjr_features 表有数据。
    const fc = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM zjjr_features`
    );
    console.log(`[smoke-test] 3. zjjr_features 行数：${fc[0].n}`);
    assert(Number(fc[0].n) > 0, "zjjr_features 应有数据");

    // 3b. 消歧：云岭资本 / 云岭投资 近似名应产出 pending_merge 标记（不自动合并）。
    const pend = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM zjjr_institutions
        WHERE metadata ? 'pending_merge'`
    );
    console.log(`[smoke-test] 3b. 带 pending_merge 标记的机构：${pend[0].n}`);

    // 4. 模拟 knowledgeSearch 的 zjjr 路：直接查表（valid_until 内 + 来源标注）。
    //    （此处不依赖能力位与登录态，直接验证检索面有可命中内容。）
    const hits = await query<{ title: string; content: string; valid_until: string }>(
      `SELECT title, content, valid_until::text AS valid_until
         FROM zjjr_features
        WHERE valid_until > NOW()
        ORDER BY data_as_of DESC
        LIMIT 3`
    );
    console.log(`[smoke-test] 4. 有效期内可检索特征样例：`);
    for (const h of hits) {
      console.log(`   - ${h.title}（有效至 ${h.valid_until}）`);
      assert(
        h.content.includes("中鉴基金研究院"),
        "特征正文应带「来源：中鉴基金研究院」标注"
      );
    }
    assert(hits.length > 0, "应有有效期内可检索的特征");

    console.log("\n[smoke-test] ✅ 全部通过");
  } catch (e) {
    failed = true;
    console.error(e instanceof Error ? e.message : String(e));
  } finally {
    await pool.end();
  }
  if (failed) process.exitCode = 1;
}

void main();
