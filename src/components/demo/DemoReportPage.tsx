import Link from "next/link";
import { BRAND } from "@/lib/brand";
import ReactMarkdown from "react-markdown";

export interface DemoMeta {
  title: string;
  company: string;
  sector: string;
  stage: string;
  raise: string;
  highlights: string;
  financials: string;
  team: string;
}

interface Props {
  meta: DemoMeta;
  report: string; // 七章节 Markdown
}

export function DemoReportPage({ meta, report }: Props) {
  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      {/* 顶部横幅 */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-900">
          示例项目 · 只读展示
        </p>
        <p className="mt-1 text-xs leading-5 text-amber-700">
          这是一个虚构项目，仅用于演示 {BRAND.productName} 的分析能力。
        </p>
      </div>

      {/* 项目信息卡 */}
      <div className="card-base mt-6 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-800">
              {meta.company}
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">
                虚构
              </span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {meta.sector} · {meta.stage} · 融资需求 {meta.raise}
            </p>
          </div>
          <Link
            href="/projects"
            className="shrink-0 rounded-lg bg-[#1B6FE8] px-3.5 py-1.5 text-sm font-medium tracking-[0.01em] text-white transition-colors duration-150 hover:bg-[#1762d0]"
          >
            上传你的 BP →
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <InfoBlock label="核心亮点" value={meta.highlights} />
          <InfoBlock label="财务数据（虚构）" value={meta.financials} />
          <InfoBlock label="团队" value={meta.team} />
        </div>
      </div>

      {/* 七章节报告正文 */}
      <article className="report-body mt-8">
        <ReactMarkdown>{report}</ReactMarkdown>
      </article>

      {/* 底部 CTA */}
      <div className="card-base mt-12 flex flex-col items-center px-6 py-8 text-center">
        <p className="text-base font-medium text-slate-800">
          想要这样的分析报告？
        </p>
        <p className="mt-1 text-sm text-slate-500">
          上传你的 BP，让 {BRAND.productName} 基于你的判断风格生成专属分析
        </p>
        <Link
          href="/projects"
          className="mt-4 rounded-lg bg-[#1B6FE8] px-5 py-2 text-sm font-medium tracking-[0.01em] text-white transition-colors duration-150 hover:bg-[#1762d0]"
        >
          上传你的 BP，生成专属分析 →
        </Link>
      </div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-600">{value}</p>
    </div>
  );
}
