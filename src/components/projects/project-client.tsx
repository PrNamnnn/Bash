"use client";

import { useState, type ReactNode } from "react";
import { CircleCheck, Circle, Eye, Lightbulb, Lock } from "lucide-react";
import { actions } from "@/lib/progress/store";
import { useHydrated, useProgress } from "@/lib/progress/hooks";
import { Inline } from "@/components/content/inline";
import { cn } from "@/lib/cn";

export function StepToggle({ project, step, title, projectTitle }: { project: string; step: string; title: string; projectTitle: string }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const done = hydrated && !!p.projects[project]?.steps.includes(step);
  return (
    <button
      type="button"
      onClick={() => actions.toggleProjectStep(project, step, projectTitle)}
      aria-pressed={done}
      aria-label={`${done ? "Unmark" : "Mark"} step "${title}" as done`}
      className={cn("flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors", done ? "text-accent" : "text-fg-subtle hover:bg-surface-3 hover:text-fg")}
    >
      {done ? <CircleCheck size={15} /> : <Circle size={15} />}
      {done ? "Done" : "Mark done"}
    </button>
  );
}

export function ProjectProgress({ project, title, stepIds }: { project: string; title: string; stepIds: string[] }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const rec = hydrated ? p.projects[project] : undefined;
  const done = rec ? stepIds.filter((s) => rec.steps.includes(s)).length : 0;
  const complete = !!rec?.completedAt;
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">Your progress</p>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-violet transition-[width] duration-500" style={{ width: `${(done / stepIds.length) * 100}%` }} />
        </div>
        <span className="text-[12px] text-fg-muted tabular-nums">
          {done}/{stepIds.length}
        </span>
      </div>
      <button
        type="button"
        onClick={() => actions.setProjectComplete(project, title, !complete)}
        className={cn(
          "flex h-9 w-full items-center justify-center gap-2 rounded-md text-[13px] font-medium transition-colors",
          complete ? "border border-accent/40 text-accent hover:bg-accent-dim/30" : "bg-accent text-accent-fg hover:bg-accent-strong",
        )}
        aria-pressed={complete}
      >
        {complete ? <CircleCheck size={15} /> : <Circle size={15} />}
        {complete ? "Project completed" : "Mark project complete"}
      </button>
    </div>
  );
}

export function HintList({ hints }: { hints: string[] }) {
  const [shown, setShown] = useState(0);
  return (
    <div className="space-y-2">
      {hints.slice(0, shown).map((h, i) => (
        <p key={i} className="flex gap-2 rounded-md bg-amber-dim/40 px-3 py-2 text-[14px] text-fg-muted">
          <Lightbulb size={15} className="mt-1 shrink-0 text-amber" />
          <span>
            <Inline text={h} />
          </span>
        </p>
      ))}
      {shown < hints.length ? (
        <button type="button" onClick={() => setShown((n) => n + 1)} className="flex items-center gap-1.5 rounded-md border border-amber/40 px-3 py-1.5 text-[13px] text-amber hover:bg-amber-dim/40">
          <Lightbulb size={14} /> {shown === 0 ? "Show the first hint" : `Show hint ${shown + 1} of ${hints.length}`}
        </button>
      ) : (
        <p className="text-[12.5px] text-fg-subtle">That&apos;s every hint.</p>
      )}
    </div>
  );
}

/** Content that stays hidden until the learner explicitly asks for it. */
export function Reveal({ label, warning, children }: { label: string; warning: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (open) return <div className="animate-fade-in">{children}</div>;
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center">
      <Lock size={18} className="mx-auto text-fg-subtle" />
      <p className="mt-2 text-[13.5px] text-fg-muted">{warning}</p>
      {confirming ? (
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-md bg-violet px-3 py-1.5 text-[13px] font-medium text-bg hover:opacity-90">
            <Eye size={14} /> Yes, show it
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-3 py-1.5 text-[13px] text-fg-muted hover:text-fg">
            Keep trying
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] text-fg-muted hover:border-line-strong hover:text-fg">
          <Eye size={14} /> {label}
        </button>
      )}
    </div>
  );
}
