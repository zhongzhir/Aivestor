import Link from "next/link";
import { QUICK_WORK_SCENES } from "@/lib/workScenes";

export function QuickWorkLauncher() {
  return (
    <section aria-labelledby="quick-work-title" className="mt-5">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="quick-work-title" className="text-base font-semibold text-ink">
            开始一项工作
          </h2>
          <p className="mt-1 text-xs leading-5 text-ink-soft">
            先选择目标，再进入对应流程；不需要先判断该用哪个功能。
          </p>
        </div>
        <Link href="/chat" className="shrink-0 text-xs font-medium text-accent hover:underline">
          直接讨论问题 →
        </Link>
      </div>

      <div className="flex snap-x gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible">
        {QUICK_WORK_SCENES.map((scene) => (
          <Link
            key={scene.id}
            href={scene.href}
            className="group min-w-[15rem] snap-start rounded-xl border border-line bg-white p-4 transition-colors hover:border-[#b7c8bc] hover:bg-[#f7fbf8] sm:min-w-0"
          >
            <span className="text-xs font-medium text-accent">{scene.eyebrow}</span>
            <span className="mt-1 block text-sm font-semibold text-ink">{scene.title}</span>
            <span className="mt-2 block text-xs leading-5 text-ink-soft">
              {scene.description}
            </span>
            <span className="mt-3 block text-xs font-medium text-accent group-hover:underline">
              开始 →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
