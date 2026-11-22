import type { Difficulty } from "@/types/content";
import { cn } from "@/lib/cn";

const STYLES: Record<Difficulty, string> = {
  beginner: "text-accent bg-accent-dim/60",
  intermediate: "text-blue bg-blue-dim/70",
  advanced: "text-amber bg-amber-dim/70",
  expert: "text-violet bg-violet-dim/70",
};

const LABELS: Record<Difficulty, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };

export function DifficultyBadge({ level, className }: { level: Difficulty; className?: string }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-medium", STYLES[level], className)}>{LABELS[level]}</span>;
}

/** Four-bar difficulty meter. */
export function DifficultyBars({ level }: { level: Difficulty }) {
  const n = { beginner: 1, intermediate: 2, advanced: 3, expert: 4 }[level];
  return (
    <span className="inline-flex items-end gap-[2px]" aria-label={LABELS[level]} title={LABELS[level]}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn("w-[3px] rounded-sm", i <= n ? "bg-fg-muted" : "bg-line-strong")} style={{ height: 4 + i * 2 }} />
      ))}
    </span>
  );
}
