"use client";

import { useEffect, useRef, useState } from "react";

interface SearchResult {
  id: string;
  name: string;
  institution_type: string | null;
  region: string | null;
  reg_status: string | null;
  manage_scale: string | null;
  focus_sectors: string[];
  focus_stages: string[];
  data_as_of: string | null;
}

interface Deal {
  target_company: string;
  stage: string | null;
  invested_at: string | null;
}

interface Detail {
  institution: SearchResult & { fund_count: number | null };
  last12mDealCount: number;
  recentDeals: Deal[];
}

function disclaimer(dataAsOf: string | null): string {
  const asOf = dataAsOf ?? "—";
  return (
    `数据来源：中鉴基金研究院，数据截止 ${asOf}，仅供内部研究参考，` +
    "不构成任何投资建议或对相关机构的资信评价。请勿对外传播或用于商业用途。" +
    "如需完整数据服务，请联系中鉴基金研究院。"
  );
}

function chips(items: string[]): string {
  return items.length ? items.join("、") : "—";
}

// 机构点查（架构 6.3）：搜索框（300ms 防抖）+ 结果列表 + 点击展开详情。
// 无批量导出按钮；每页底部固定免责声明。
export default function InstitutionLookup() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = q.trim();
    if (term.length < 1) {
      setResults(null);
      setDataAsOf(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setRateLimited(false);
      fetch(`/api/data-apps/institutions/search?q=${encodeURIComponent(term)}`)
        .then(async (r) => {
          if (r.status === 429) {
            setRateLimited(true);
            setResults([]);
            return null;
          }
          return r.ok ? r.json() : Promise.reject();
        })
        .then((d) => {
          if (d) {
            setResults(d.results ?? []);
            setDataAsOf(d.dataAsOf ?? null);
          }
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  function openDetail(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setDetailLoading(true);
    fetch(`/api/data-apps/institutions/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">🔎 机构点查</h1>
      <p className="mt-1 text-sm text-ink-soft">投资机构简要画像查询</p>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="输入机构名称搜索"
        className="mt-5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-[#0D1B3E]"
      />

      <div className="mt-4 space-y-2">
        {rateLimited && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            点查过于频繁，请稍后再试（每小时上限 60 次）。
          </div>
        )}

        {results === null && !rateLimited && (
          <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-ink-soft">
            输入机构名称搜索
          </div>
        )}

        {loading && (
          <div className="px-1 py-1 text-xs text-ink-faint">搜索中…</div>
        )}

        {results !== null && !loading && results.length === 0 && !rateLimited && (
          <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-ink-soft">
            未找到匹配机构
          </div>
        )}

        {results?.map((inst) => {
          const open = openId === inst.id;
          return (
            <div
              key={inst.id}
              className="rounded-lg border border-line bg-white px-4 py-3"
            >
              <button
                onClick={() => openDetail(inst.id)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{inst.name}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {[inst.institution_type, inst.region, inst.reg_status]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-accent">
                  {open ? "收起" : "详情"}
                </span>
              </button>

              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-soft">
                <dt className="text-ink-faint">管理规模</dt>
                <dd>{inst.manage_scale ?? "—"}</dd>
                <dt className="text-ink-faint">关注赛道</dt>
                <dd>{chips(inst.focus_sectors)}</dd>
                <dt className="text-ink-faint">关注阶段</dt>
                <dd>{chips(inst.focus_stages)}</dd>
              </dl>

              {open && (
                <div className="mt-3 border-t border-line pt-3">
                  {detailLoading && (
                    <p className="text-xs text-ink-faint">加载详情…</p>
                  )}
                  {!detailLoading && detail && detail.institution.id === inst.id && (
                    <div className="text-xs text-ink-soft">
                      <p>
                        <span className="text-ink-faint">基金数量：</span>
                        {detail.institution.fund_count ?? "—"}
                        <span className="ml-3 text-ink-faint">
                          近 12 月出手：
                        </span>
                        {detail.last12mDealCount} 笔
                      </p>
                      <p className="mt-2 text-ink-faint">最近投资事件</p>
                      {detail.recentDeals.length === 0 ? (
                        <p className="mt-1">暂无公开记录</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5">
                          {detail.recentDeals.map((d, i) => (
                            <li key={i}>
                              {d.target_company}
                              {d.stage ? ` · ${d.stage}` : ""}
                              {d.invested_at ? ` · ${d.invested_at}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {!detailLoading && !detail && (
                    <p className="text-xs text-ink-faint">详情加载失败</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-6 border-t border-line pt-4 text-xs text-ink-faint">
        {disclaimer(dataAsOf)}
      </p>
    </div>
  );
}
