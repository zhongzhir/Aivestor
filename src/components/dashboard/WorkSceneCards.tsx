import Link from "next/link";
import { WORK_SCENES } from "@/lib/workScenes";

export function WorkSceneCards() {
  return (
    <section className="mt-6 rounded-lg border border-line bg-white p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">快速完成一项投资工作</p>
          <p className="mt-1 text-xs leading-5 text-ink-soft">
            选择你要交付的结果，继续使用现有项目、分析框架和情报流程。
          </p>
        </div>
        <span className="text-xs text-ink-faint">常用场景</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {WORK_SCENES.map((scene) => (
          <Link
            key={scene.id}
            href={scene.href}
            className="group flex min-h-[190px] flex-col rounded-xl border border-line bg-[#fffdfa] p-4 transition-colors hover:border-[#b7c8bc] hover:bg-[#f7fbf8]"
          >
            <span className="text-xs font-medium text-accent">{scene.eyebrow}</span>
            <span className="mt-2 text-base font-semibold text-ink">{scene.title}</span>
            <span className="mt-2 text-xs leading-5 text-ink-soft">{scene.description}</span>
            <span className="mt-4 grid gap-1.5 border-t border-line pt-3 text-xs text-ink-faint">
              <span><span className="font-medium text-ink-soft">需要：</span>{scene.input}</span>
              <span><span className="font-medium text-ink-soft">得到：</span>{scene.output}</span>
            </span>
            <span className="mt-auto pt-4 text-xs font-medium text-accent">开始 →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
