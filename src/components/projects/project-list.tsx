"use client";

import Link from "next/link";
import { CircleCheck, Clock } from "lucide-react";
import type { ProjectMeta } from "@/types/content";
import { useHydrated, useProgress } from "@/lib/progress/hooks";
import { DifficultyBadge } from "@/components/ui/badges";

export function ProjectList({ projects }: { projects: ProjectMeta[] }) {
  const p = useProgress();
  const hydrated = useHydrated();
  return (
    <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((pr) => {
        const rec = hydrated ? p.projects[pr.slug] : undefined;
        return (
          <li key={pr.slug}>
            <Link href={`/projects/${pr.slug}`} className="group flex h-full flex-col rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-fg-subtle">#{String(pr.number).padStart(2, "0")}</span>
                <DifficultyBadge level={pr.difficulty} />
                {rec?.completedAt ? (
                  <span className="ml-auto flex items-center gap-1 text-[12px] text-accent">
                    <CircleCheck size={13} /> Completed
                  </span>
                ) : rec?.steps.length ? (
                  <span className="ml-auto text-[12px] text-violet">{rec.steps.length} steps done</span>
                ) : null}
              </div>
              <h2 className="mt-3 text-[16px] font-semibold text-fg group-hover:text-accent">{pr.title}</h2>
              <p className="mt-1 flex-1 text-[13.5px] text-fg-muted">{pr.summary}</p>
              <p className="mt-4 flex items-center gap-1 text-[12px] text-fg-subtle">
                <Clock size={12} /> ~{pr.hours} h
              </p>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
