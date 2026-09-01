import Link from "next/link";

export type ResultAction = {
  label: string;
  href: string;
  primary?: boolean;
};

export function ResultNextActions({
  title = "接下来可以继续",
  description,
  actions,
  compact = false,
}: {
  title?: string;
  description?: string;
  actions: ResultAction[];
  compact?: boolean;
}) {
  if (actions.length === 0) return null;

  return (
    <aside className={`rounded-lg border border-[#d9e3dc] bg-[#f7fbf8] ${compact ? "p-3" : "p-4"}`}>
      <p className="text-xs font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 text-xs leading-5 text-ink-soft">{description}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Link
            key={`${action.href}-${action.label}`}
            href={action.href}
            className={action.primary
              ? "rounded-md bg-accent px-3 py-2 text-xs font-medium text-white hover:opacity-90"
              : "rounded-md border border-line bg-white px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface"}
          >
            {action.label}
          </Link>
        ))}
      </div>
    </aside>
  );
}
