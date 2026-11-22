"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, CircleCheck, Circle } from "lucide-react";
import type { Challenge, Difficulty } from "@/types/content";
import { Exercise } from "@/components/exercises/exercise";
import { useHydrated, useProgress } from "@/lib/progress/hooks";
import { DifficultyBadge } from "@/components/ui/badges";
import { Segmented } from "@/components/viz/primitives";
import { cn } from "@/lib/cn";

const ORDER: Difficulty[] = ["beginner", "intermediate", "advanced", "expert"];
const LABEL: Record<Difficulty, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };

export function ChallengeBoard({ challenges }: { challenges: (Challenge & { lessonTitle?: string })[] }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const [tab, setTab] = useState<Difficulty>("beginner");
  const [open, setOpen] = useState<string | null>(null);
  const list = challenges.filter((c) => c.difficulty === tab);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          label="Difficulty"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setOpen(null);
          }}
          options={ORDER.map((d) => {
            const all = challenges.filter((c) => c.difficulty === d);
            const solved = hydrated ? all.filter((c) => p.exercises[c.exercise.id]?.solved).length : 0;
            return { value: d, label: `${LABEL[d]} ${solved}/${all.length}` };
          })}
        />
      </div>
      <ul className="space-y-2">
        {list.map((c) => {
          const solved = hydrated && p.exercises[c.exercise.id]?.solved;
          const isOpen = open === c.id;
          return (
            <li key={c.id} className="overflow-hidden rounded-lg border border-line bg-surface">
              <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60" aria-expanded={isOpen}>
                {solved ? <CircleCheck size={16} className="shrink-0 text-accent" /> : <Circle size={16} className="shrink-0 text-line-strong" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] text-fg">{c.title}</span>
                  <span className="block text-[12px] text-fg-subtle">{c.topic}</span>
                </span>
                <DifficultyBadge level={c.difficulty} className="hidden sm:inline" />
                <ChevronRight size={16} className={cn("shrink-0 text-fg-subtle transition-transform", isOpen && "rotate-90")} />
              </button>
              {isOpen && (
                <div className="border-t border-line px-4 pb-2 [&>div]:my-3">
                  <Exercise exercise={c.exercise} context="Challenge" />
                  {c.lesson && c.lessonTitle && (
                    <p className="pb-2 text-[12.5px] text-fg-subtle">
                      Review:{" "}
                      <Link href={`/learn/${c.lesson}`} className="text-accent hover:underline">
                        {c.lessonTitle}
                      </Link>
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {!list.length && <li className="rounded-lg border border-line px-4 py-8 text-center text-fg-subtle">No challenges at this level yet.</li>}
      </ul>
    </div>
  );
}
