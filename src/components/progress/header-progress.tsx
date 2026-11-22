"use client";

import Link from "next/link";
import { useProgress, useHydrated } from "@/lib/progress/hooks";
import { computeStreak } from "@/lib/progress/store";
import { Flame } from "lucide-react";

export function HeaderProgress({ slugs }: { slugs: string[] }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const done = hydrated ? slugs.filter((s) => p.lessons[s]).length : 0;
  const pct = slugs.length ? Math.round((done / slugs.length) * 100) : 0;
  const streak = hydrated ? computeStreak(p.activityDays).current : 0;
  return (
    <Link
      href="/dashboard"
      className="hidden items-center gap-3 rounded-md border border-line px-2.5 py-1.5 text-[12.5px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg sm:flex"
      aria-label={`Progress: ${done} of ${slugs.length} lessons complete, ${streak} day streak`}
    >
      <span className="flex items-center gap-2">
        <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </span>
        <span className="tabular-nums">{pct}%</span>
      </span>
      <span className="flex items-center gap-1 tabular-nums" aria-hidden>
        <Flame size={13} className={streak ? "text-amber" : "text-fg-subtle"} />
        {streak}
      </span>
    </Link>
  );
}
