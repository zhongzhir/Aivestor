"use client";

import { useEffect, useState } from "react";
import { STAGE_LABELS } from "@/lib/stages";

interface MemberJudgment {
  stage: string;
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
  created_at: string;
}

interface MemberJudgments {
  userId: string;
  userName: string;
  role: string;
  judgments: MemberJudgment[];
}

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  partner: "合伙人",
  analyst: "分析师",
};

// 组织项目判断 tab：按人分组的并列视图（partner/admin 可见，见 4.3）。
// analyst 调用聚合接口会得到 403，组件静默隐藏。
// onHasData：上报是否有可展示的团队判断，供父级决定单栏/双栏布局（方案 B）。
export function JudgmentsByMember({
  projectId,
  onHasData,
}: {
  projectId: string;
  onHasData?: (hasData: boolean) => void;
}) {
  const [members, setMembers] = useState<MemberJudgments[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(
        `/api/projects/${projectId}/judgments/aggregate`
      );
      if (res.status === 403) {
        setForbidden(true);
        onHasData?.(false);
        return;
      }
      if (res.ok) {
        const list: MemberJudgments[] = (await res.json()).members ?? [];
        setMembers(list);
        onHasData?.(list.length > 0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (forbidden || members === null) return null;
  if (members.length === 0) {
    return (
      <p className="text-xs text-ink-soft">组织成员暂未录入判断。</p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {members.map((m) => (
        <div key={m.userId} className="rounded border border-line p-3">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <span className="text-sm font-medium text-ink">{m.userName}</span>
            <span className="text-xs text-ink-soft">
              {ROLE_LABEL[m.role] ?? m.role}
            </span>
          </div>
          <div className="mt-2 space-y-3">
            {m.judgments.map((j, i) => (
              <div key={i} className="text-xs">
                <div className="font-medium text-ink">
                  {STAGE_LABELS[j.stage] ?? j.stage}
                  {j.confidence_level != null && (
                    <span className="ml-2 text-ink-soft">
                      信心 {j.confidence_level}/5
                    </span>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5 text-ink-soft">
                  {j.bull_case && <li>看好：{j.bull_case}</li>}
                  {j.bear_case && <li>顾虑：{j.bear_case}</li>}
                  {j.founder_assessment && (
                    <li>创始人：{j.founder_assessment}</li>
                  )}
                  {j.key_hypothesis && <li>关键假设：{j.key_hypothesis}</li>}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
