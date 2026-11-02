import Link from "next/link";
import { WORK_SCENES } from "@/lib/workScenes";

export function WorkSceneCards() {
  return (
    <details className="group mt-6 rounded-lg border border-line bg-white">
      <summary className="flex cursor-pointer list-none flex-col gap-2 p-5 marker:content-none sm:flex-row sm:items-center sm:justify-between">
        <span>
          <span className="block text-sm font-semibold text-ink">其他常用工作</span>
          <span className="mt-1 block text-xs leading-5 text-ink-soft">
            批量初筛、行业研究、尽调准备、IC 和情报入口都保留在这里。
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-accent">
          <span className="group-open:hidden">展开 6 个场景</span>
          <span className="hidden group-open:inline">收起场景</span>
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span>
        </span>
      </summary>

      <div className="grid gap-3 border-t border-line p-5 pt-4 md:grid-cols-2 xl:grid-cols-3">
        {WORK_SCENES.map((scene) => (
          <Link
            key={scene.id}
            href={scene.href}
            className="group/card flex min-h-[168px] flex-col rounded-xl border border-line bg-[#fffdfa] p-4 transition-colors hover:border-[#b7c8bc] hover:bg-[#f7fbf8]"
          >
            <span className="text-xs font-medium text-accent">{scene.eyebrow}</span>
            <span className="mt-2 text-base font-semibold text-ink">{scene.title}</span>
            <span className="mt-2 text-xs leading-5 text-ink-soft">{scene.description}</span>
            <span className="mt-3 grid gap-1 border-t border-line pt-3 text-xs text-ink-faint">
              <span><span className="font-medium text-ink-soft">需要：</span>{scene.input}</span>
              <span><span className="font-medium text-ink-soft">得到：</span>{scene.output}</span>
            </span>
            <span className="mt-auto pt-3 text-xs font-medium text-accent">开始 →</span>
          </Link>
        ))}
      </div>
    </details>
  );
}
