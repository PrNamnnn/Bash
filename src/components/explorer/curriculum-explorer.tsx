"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, CircleCheck, Circle, Clock, Search } from "lucide-react";
import type { Difficulty, LevelMeta } from "@/types/content";
import { useHydrated, useProgress } from "@/lib/progress/hooks";
import { DifficultyBadge, DifficultyBars } from "@/components/ui/badges";
import { cn } from "@/lib/cn";

type Status = "all" | "todo" | "done";

export function CurriculumExplorer({ levels }: { levels: LevelMeta[] }) {
  const progress = useProgress();
  const hydrated = useHydrated();
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty | "all">("all");
  const [status, setStatus] = useState<Status>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const q = useDeferredValue(query.trim().toLowerCase());

  const filtered = useMemo(() => {
    return levels
      .map((level) => ({
        ...level,
        modules: level.modules
          .map((m) => ({
            ...m,
            lessons: m.lessons.filter((l) => {
              if (difficulty !== "all" && l.difficulty !== difficulty) return false;
              const done = hydrated && !!progress.lessons[l.slug];
              if (status === "done" && !done) return false;
              if (status === "todo" && done) return false;
              if (!q) return true;
              return `${l.title} ${l.summary} ${l.tags.join(" ")} ${m.title} ${level.title}`.toLowerCase().includes(q);
            }),
          }))
          .filter((m) => m.lessons.length),
      }))
      .filter((l) => l.modules.length);
  }, [levels, q, difficulty, status, progress.lessons, hydrated]);

  const shownCount = filtered.reduce((n, l) => n + l.modules.reduce((k, m) => k + m.lessons.length, 0), 0);
  const filtering = q || difficulty !== "all" || status !== "all";

  return (
    <div>
      <div className="sticky top-[var(--header-h)] z-20 -mx-4 mb-6 flex flex-col gap-2 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:rounded-lg sm:border sm:px-3">
        <label className="relative flex-1">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
          <span className="sr-only">Filter lessons</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by topic, command or concept — e.g. grep, quoting, trap"
            className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-[13.5px] text-fg placeholder:text-fg-subtle focus:border-accent/50 focus:outline-none"
          />
        </label>
        <div className="flex gap-2">
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty | "all")}
            className="h-9 rounded-md border border-line bg-surface px-2 text-[13px] text-fg-muted focus:outline-none"
            aria-label="Difficulty"
          >
            <option value="all">All levels</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="expert">Expert</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className="h-9 rounded-md border border-line bg-surface px-2 text-[13px] text-fg-muted focus:outline-none" aria-label="Status">
            <option value="all">Any status</option>
            <option value="todo">Not completed</option>
            <option value="done">Completed</option>
          </select>
        </div>
      </div>

      {filtering && (
        <p className="mb-4 text-[13px] text-fg-subtle" aria-live="polite">
          {shownCount} matching lesson{shownCount === 1 ? "" : "s"}
        </p>
      )}

      <div className="space-y-4">
        {filtered.map((level) => {
          const all = levels.find((l) => l.id === level.id)!.modules.flatMap((m) => m.lessons);
          const done = hydrated ? all.filter((l) => progress.lessons[l.slug]).length : 0;
          const pct = Math.round((done / all.length) * 100);
          const isCollapsed = collapsed[level.id] && !filtering;
          return (
            <section key={level.id} id={level.id} className="scroll-mt-32 overflow-hidden rounded-xl border border-line bg-surface">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [level.id]: !c[level.id] }))}
                className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2/50"
                aria-expanded={!isCollapsed}
              >
                <span className="mt-0.5 font-mono text-[22px] leading-none font-semibold text-fg-subtle tabular-nums">{String(level.number).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[17px] font-semibold text-fg">{level.title}</span>
                    <DifficultyBadge level={level.difficulty} />
                  </span>
                  <span className="mt-1 block text-[13.5px] text-fg-muted">{level.description}</span>
                  <span className="mt-3 flex items-center gap-3 text-[12px] text-fg-subtle">
                    <span className="h-1 w-32 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="tabular-nums">
                      {done}/{all.length} lessons
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={12} /> {Math.round(all.reduce((s, l) => s + l.minutes, 0) / 6) / 10} h
                    </span>
                  </span>
                </span>
                <ChevronDown size={18} className={cn("mt-1 shrink-0 text-fg-subtle transition-transform", isCollapsed && "-rotate-90")} />
              </button>
              {!isCollapsed && (
                <div className="grid gap-x-8 border-t border-line px-5 py-4 md:grid-cols-2">
                  {level.modules.map((m) => (
                    <div key={m.id} className="mb-3">
                      <h3 className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">{m.title}</h3>
                      <ul className="space-y-0.5">
                        {m.lessons.map((l) => {
                          const complete = hydrated && !!progress.lessons[l.slug];
                          return (
                            <li key={l.slug}>
                              <Link href={`/learn/${l.slug}`} className="group flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-surface-2">
                                {complete ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-accent" /> : <Circle size={15} className="mt-0.5 shrink-0 text-line-strong" />}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[14px] leading-snug text-fg-muted group-hover:text-fg">{l.title}</span>
                                  <span className="mt-0.5 line-clamp-1 block text-[12px] text-fg-subtle">{l.summary}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-2 pt-0.5 text-[11px] text-fg-subtle">
                                  <DifficultyBars level={l.difficulty} />
                                  <span className="w-11 text-right tabular-nums">{l.minutes} min</span>
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {!filtered.length && <p className="rounded-lg border border-line px-4 py-10 text-center text-fg-subtle">No lessons match these filters.</p>}
      </div>
    </div>
  );
}
