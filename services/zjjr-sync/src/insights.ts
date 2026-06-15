// 市场洞察预生成（架构文档 v1.1 第 6.2 节，P6 补全）。
//
// 机制：每周一 03:30（PM2 第二个 cron 进程，见 ecosystem.config.js）聚合上周
//   zjjr_investments → 拼 prompt → 调平台系统 Key（DeepSeek，复用
//   SYSTEM_DEEPSEEK_API_KEY 同一环境变量约定）生成 Markdown → upsert market_insights。
//   生成失败保留上期内容（不写表），页面无感。
//
// 账号：本服务以专用账号 zjjr_sync 连库（与 zjjr_* 同账号；market_insights 的
//   GRANT 见迁移 029 末尾人工执行段）。不使用主应用账号。

import { query } from "./db";

export interface InsightsResult {
  generated: number; // 写入条数（0/1）
  skipped: boolean;
  note: string;
}

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

interface DistRow {
  k: string;
  c: string;
}
interface ActiveInstRow {
  name: string;
  c: string;
}

function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return { year: date.getUTCFullYear(), week };
}

function distText(rows: DistRow[]): string {
  if (rows.length === 0) return "无";
  return rows.map((r) => `${r.k || "未知"} ${r.c} 笔`).join("，");
}

async function callDeepSeek(
  system: string,
  user: string
): Promise<string | null> {
  const apiKey = process.env.SYSTEM_DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const res = await fetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
        stream: false,
      }),
    });
    if (!res.ok) {
      console.error(`[insights] DeepSeek 请求失败 ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("[insights] DeepSeek 异常:", e);
    return null;
  }
}

// 生成本周市场洞察并 upsert。windowDays 默认 7（上周）。
export async function generateMarketInsights(
  opts?: { windowDays?: number }
): Promise<InsightsResult> {
  const windowDays = opts?.windowDays ?? 7;
  const now = new Date();
  const dataAsOf = now.toISOString().slice(0, 10);
  const { year, week } = isoWeek(now);
  const period = `${year}-W${String(week).padStart(2, "0")}`;

  // 1. 聚合上周投资事件的赛道 / 轮次分布。
  const [sectorDist, stageDist, activeInsts, totalRows] = await Promise.all([
    query<DistRow>(
      `SELECT COALESCE(sector, '未分类') AS k, COUNT(*)::text AS c
         FROM zjjr_investments
        WHERE invested_at >= (CURRENT_DATE - ($1 || ' days')::interval)
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10`,
      [String(windowDays)]
    ),
    query<DistRow>(
      `SELECT COALESCE(stage, '未知') AS k, COUNT(*)::text AS c
         FROM zjjr_investments
        WHERE invested_at >= (CURRENT_DATE - ($1 || ' days')::interval)
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10`,
      [String(windowDays)]
    ),
    // 活跃机构 Top5（近 12 月出手最多）
    query<ActiveInstRow>(
      `SELECT i.name, COUNT(v.id)::text AS c
         FROM zjjr_investments v
         JOIN zjjr_institutions i ON i.id = v.institution_id
        WHERE v.invested_at >= (CURRENT_DATE - INTERVAL '12 months')
        GROUP BY i.id, i.name
        ORDER BY COUNT(v.id) DESC, i.name ASC
        LIMIT 5`
    ),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM zjjr_investments
        WHERE invested_at >= (CURRENT_DATE - ($1 || ' days')::interval)`,
      [String(windowDays)]
    ),
  ]);

  const totalDeals = Number(totalRows[0]?.c) || 0;

  // 2. 拼 prompt 调 DeepSeek 生成 Markdown 摘要。
  const system =
    "你是中鉴基金研究院的市场研究员。基于给定的脱敏统计数据，撰写一份 300–500 字的" +
    "周度一级市场动态摘要，使用简体中文与 Markdown。只能依据给定数据，不得编造具体" +
    "机构名录或投资明细，不得罗列超出给定范围的清单。语气客观克制。";
  const user = `统计区间：最近 ${windowDays} 天（周期 ${period}，数据截止 ${dataAsOf}）

- 本期投资事件总数：${totalDeals}
- 赛道分布：${distText(sectorDist)}
- 轮次分布：${distText(stageDist)}
- 近 12 月活跃机构 Top5：${
    activeInsts.length
      ? activeInsts.map((a) => `${a.name}（${a.c} 笔）`).join("、")
      : "无"
  }

请输出：① 一句话总览；② 赛道与轮次观察（2–3 句）；③ 活跃机构观察（1–2 句）。`;

  const content = await callDeepSeek(system, user);
  if (!content) {
    return {
      generated: 0,
      skipped: true,
      note: "DeepSeek 未配置 / 生成失败，保留上期内容（未写表）",
    };
  }

  // 3. Upsert 写入 market_insights。
  const title = `${year} 年第 ${week} 周一级市场动态`;
  await query(
    `INSERT INTO market_insights (period, period_kind, title, content, data_as_of)
     VALUES ($1, 'weekly', $2, $3, $4)
     ON CONFLICT (period, period_kind) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       data_as_of = EXCLUDED.data_as_of,
       generated_at = now()`,
    [period, title, content, dataAsOf]
  );

  return {
    generated: 1,
    skipped: false,
    note: `已生成 ${period} 周报（事件 ${totalDeals} 笔）`,
  };
}
