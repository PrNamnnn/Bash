"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, CircleCheck, Circle } from "lucide-react";
import { useProgress, useHydrated } from "@/lib/progress/hooks";
import { cn } from "@/lib/cn";

export interface NavLevel {
  id: string;
  number: number;
  title: string;
  modules: { id: string; title: string; lessons: { slug: string; title: string; minutes: number }[] }[];
}

export function CurriculumNav({ levels, current }: { levels: NavLevel[]; current: string }) {
  const progress = useProgress();
  const hydrated = useHydrated();
  const currentLevel = levels.find((l) => l.modules.some((m) => m.lessons.some((x) => x.slug === current)))?.id;
  const [open, setOpen] = useState<Record<string, boolean>>(() => (currentLevel ? { [currentLevel]: true } : {}));
  const activeRef = useRef<HTMLAnchorElement>(null);
  const [lastCurrent, setLastCurrent] = useState(current);
  if (lastCurrent !== current) {
    setLastCurrent(current);
    if (currentLevel && !open[currentLevel]) setOpen((o) => ({ ...o, [currentLevel]: true }));
  }

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <nav aria-label="Curriculum" className="text-[13px]">
      <ul className="space-y-0.5">
        {levels.map((level) => {
          const lessons = level.modules.flatMap((m) => m.lessons);
          const done = hydrated ? lessons.filter((l) => progress.lessons[l.slug]).length : 0;
          const isOpen = open[level.id];
          return (
            <li key={level.id}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [level.id]: !o[level.id] }))}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2", level.id === currentLevel ? "text-fg" : "text-fg-muted")}
                aria-expanded={isOpen}
              >
                <ChevronRight size={13} className={cn("shrink-0 text-fg-subtle transition-transform", isOpen && "rotate-90")} />
                <span className="w-5 shrink-0 font-mono text-[11px] text-fg-subtle">{String(level.number).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{level.title}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-fg-subtle tabular-nums">
                  {done}/{lessons.length}
                </span>
              </button>
              {isOpen && (
                <div className="mt-0.5 mb-2 ml-[1.15rem] border-l border-line pl-2">
                  {level.modules.map((m) => (
                    <div key={m.id} className="mb-1.5">
                      <div className="px-2 pt-1.5 pb-0.5 text-[10.5px] font-medium tracking-wide text-fg-subtle uppercase">{m.title}</div>
                      <ul>
                        {m.lessons.map((l) => {
                          const active = l.slug === current;
                          const complete = hydrated && !!progress.lessons[l.slug];
                          return (
                            <li key={l.slug}>
                              <Link
                                ref={active ? activeRef : undefined}
                                href={`/learn/${l.slug}`}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                  "flex items-start gap-2 rounded-md px-2 py-1.5 leading-snug transition-colors",
                                  active ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                                )}
                              >
                                {complete ? <CircleCheck size={13} className="mt-[3px] shrink-0 text-accent" /> : <Circle size={13} className={cn("mt-[3px] shrink-0", active ? "text-fg-muted" : "text-line-strong")} />}
                                <span>{l.title}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
