import type { ReactNode } from "react";

export const analysisActionClass = "inline-flex min-h-10 w-full shrink-0 items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-40";

const ICONS = {
  brief: "m13 2-9 12h7l-1 8 10-12h-7l1-8Z",
  standard: "M5 3h10l4 4v14H5V3Zm10 0v5h4M8 12h8M8 16h8",
  materials: "M4 4h6l2 2h8v14H4V4Zm4 6h8M8 14h8",
  full: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 6 6M7 10h6M10 7v6",
};

export function AnalysisMethodCard({ id, icon, title, description, action, children }: {
  id?: string;
  icon: keyof typeof ICONS;
  title: string;
  description: string;
  action: ReactNode;
  children?: ReactNode;
}) {
  return <section id={id} aria-label={title} className="scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d={ICONS[icon]} /></svg>
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-6 text-slate-800">{title}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      {action}
    </div>
    {children}
  </section>;
}
