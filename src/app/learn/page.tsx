import type { Metadata } from "next";
import { curriculum } from "@/content/curriculum";
import { allLessons, formatMinutes, totalMinutes } from "@/lib/curriculum";
import { CurriculumExplorer } from "@/components/explorer/curriculum-explorer";

export const metadata: Metadata = {
  title: "Curriculum",
  description: "Fourteen levels from computing fundamentals to production Bash engineering, DevOps automation and expert projects.",
};

export default function LearnPage() {
  const lessons = allLessons();
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6">
      <header className="mb-8 max-w-3xl">
        <p className="mb-2 font-mono text-[12px] text-accent">~/curriculum</p>
        <h1 className="text-[30px] font-semibold tracking-tight text-fg">Curriculum</h1>
        <p className="mt-2 text-[15.5px] text-fg-muted">
          {curriculum.length} levels · {lessons.length} lessons · about {formatMinutes(totalMinutes(lessons))} of focused study, plus 15 guided projects. Each level builds on the
          previous one — start at Level 0 if the terminal is new to you, or jump to any topic you need.
        </p>
      </header>
      <CurriculumExplorer levels={curriculum} />
    </div>
  );
}
