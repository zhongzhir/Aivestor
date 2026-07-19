import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { CognitionAnalysis } from "@/components/cognition/CognitionAnalysis";
import {
  computeStats,
  type CognitionJudgment,
} from "@/lib/cognition";
import { STAGE_LABELS } from "@/lib/stages";
import { outcomeDef } from "@/lib/outcome";

export const dynamic = "force-dynamic";

export default async function CognitionPage() {
  const session = await requireAuth();

  let judgments: CognitionJudgment[] = [];
  try {
    judgments = await query<CognitionJudgment>(
      `SELECT ij.project_id, p.name AS project_name, p.outcome,
              ij.stage, ij.bull_case, ij.bear_case, ij.founder_assessment,
              ij.key_hypothesis, ij.confidence_level, ij.created_at
         FROM investment_judgments ij
         JOIN projects p ON ij.project_id = p.id
        WHERE ij.user_id = $1 AND p.deleted_at IS NULL
        ORDER BY ij.created_at DESC`,
      [session.user.id]
    );
  } catch (e) {
    console.error("[cognition] 判断记录读取失败:", e);
  }

  const stats = computeStats(judgments);

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      <h1 className="text-xl font-semibold text-ink">我的投资认知</h1>
      <p className="mt-1 text-xs text-ink-faint">
        基于历史判断记录，洞察你的投资判断模式与认知盲区
      </p>

      {judgments.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-line py-16 text-center">
          <p className="text-sm text-ink-soft">还没有判断记录</p>
          <p className="mt-1 text-xs text-ink-faint">
            开始记录你的投资判断，认知分析将在积累一定数据后为你提供深度洞察
          </p>
        </div>
      ) : (
        <>
          {/* 判断统计 */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="项目判断" value={`${stats.total} 条`} />
            <StatCard label="有结果" value={`${stats.withOutcome} 个`} />
            <StatCard
              label="平均信心"
              value={
                stats.avgConfidence != null
                  ? `${stats.avgConfidence.toFixed(1)} 分`
                  : "—"
              }
            />
            <StatCard
              label="判断阶段"
              value={
                stats.topStage
                  ? `最多:${STAGE_LABELS[stats.topStage] ?? stats.topStage}`
                  : "—"
              }
            />
          </div>

          {/* AI 认知模式分析 */}
          <div className="mt-8 border-t border-line pt-8">
            <CognitionAnalysis />
          </div>

          {/* 判断历史时间线 */}
          <div className="mt-8 border-t border-line pt-8">
            <h2 className="text-sm font-medium text-ink">判断历史时间线</h2>
            <div className="mt-4 space-y-3">
              {judgments.map((j, i) => (
                <TimelineItem key={i} judgment={j} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}

function TimelineItem({ judgment }: { judgment: CognitionJudgment }) {
  const conf = judgment.confidence_level ?? 0;
  const od = outcomeDef(judgment.outcome);
  return (
    <div className="rounded-lg border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-ink">{judgment.project_name}</span>
        <span className="text-ink-faint">·</span>
        <span className="text-accent">
          {STAGE_LABELS[judgment.stage] ?? judgment.stage}
        </span>
        <span className="text-ink-faint">·</span>
        <span className="text-accent">
          {conf > 0
            ? "★".repeat(conf) + "☆".repeat(5 - conf)
            : "未评分"}
        </span>
        <span className="text-ink-faint">·</span>
        <span className="text-ink-faint">
          {new Date(judgment.created_at).toLocaleString("zh-CN")}
        </span>
        {judgment.outcome && judgment.outcome !== "pending" && (
          <span
            className={`rounded px-1.5 py-0.5 font-medium ${od.badgeClass}`}
          >
            {od.icon} {od.label}
          </span>
        )}
      </div>
      <div className="mt-2 space-y-1 text-xs text-ink-soft">
        {judgment.bull_case && (
          <p>
            <span className="font-medium text-ink-soft">看好：</span>
            {judgment.bull_case}
          </p>
        )}
        {judgment.bear_case && (
          <p>
            <span className="font-medium text-ink-soft">顾虑：</span>
            {judgment.bear_case}
          </p>
        )}
        {!judgment.bull_case && !judgment.bear_case && (
          <p className="text-ink-faint">（无看好/顾虑记录）</p>
        )}
      </div>
    </div>
  );
}
