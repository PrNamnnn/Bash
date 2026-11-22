"use client";

import { useEffect, useRef, useState, useId } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, CircleCheck, Circle, NotebookPen, ArrowRight } from "lucide-react";
import { actions } from "@/lib/progress/store";
import { useHydrated, useProgress } from "@/lib/progress/hooks";
import { cn } from "@/lib/cn";

export function VisitTracker({ slug }: { slug: string }) {
  useEffect(() => {
    actions.visitLesson(slug);
  }, [slug]);
  return null;
}

export function CompleteButton({ slug, title, next }: { slug: string; title: string; next?: { slug: string; title: string } }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const done = hydrated && !!p.lessons[slug];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="text-[14px] font-medium text-fg">{done ? "Lesson complete" : "Finished this lesson?"}</p>
        <p className="text-[12.5px] text-fg-muted">{done ? "Nice work. Your progress is saved on this device." : "Mark it complete to track your progress and streak."}</p>
      </div>
      <button
        type="button"
        onClick={() => (done ? actions.uncompleteLesson(slug) : actions.completeLesson(slug, title))}
        className={cn(
          "flex h-9 items-center justify-center gap-2 rounded-md px-4 text-[13.5px] font-medium transition-colors",
          done ? "border border-accent/40 text-accent hover:bg-accent-dim/30" : "bg-accent text-accent-fg hover:bg-accent-strong",
        )}
        aria-pressed={done}
      >
        {done ? <CircleCheck size={16} /> : <Circle size={16} />}
        {done ? "Completed" : "Mark as complete"}
      </button>
      {done && next && (
        <Link href={`/learn/${next.slug}`} className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-fg-muted hover:border-line-strong hover:text-fg">
          Next <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}

export function BookmarkButton({ id, compact }: { id: string; compact?: boolean }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const on = hydrated && p.bookmarks.includes(id);
  return (
    <button
      type="button"
      onClick={() => actions.toggleBookmark(id)}
      aria-pressed={on}
      className={cn("flex items-center gap-1.5 rounded-md text-[12.5px] transition-colors", compact ? "h-8 px-2" : "h-8 border border-line px-2.5", on ? "text-amber" : "text-fg-muted hover:text-fg")}
      title={on ? "Remove bookmark" : "Bookmark this lesson"}
    >
      {on ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
      {on ? "Bookmarked" : "Bookmark"}
    </button>
  );
}

export function NotesPanel({ id, label }: { id: string; label: string }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const stored = hydrated ? (p.notes[id]?.text ?? "") : "";
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldId = useId();
  const value = text ?? stored;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div>
      <label htmlFor={fieldId} className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
        <NotebookPen size={12} /> Your notes
        <span className="ml-auto font-normal tracking-normal normal-case">{hydrated ? (saved ? (value ? "saved" : "") : "saving…") : ""}</span>
      </label>
      <textarea
        id={fieldId}
        value={value}
        disabled={!hydrated}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          setSaved(false);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            actions.setNote(id, v, label);
            setSaved(true);
          }, 600);
        }}
        rows={5}
        placeholder="Write down what clicked, questions, commands to remember…"
        className="block w-full resize-y rounded-md border border-line bg-inset px-2.5 py-2 text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent/50 focus:outline-none"
      />
    </div>
  );
}

export function ExerciseProgress({ ids }: { ids: string[] }) {
  const p = useProgress();
  const hydrated = useHydrated();
  if (!ids.length) return null;
  const solved = hydrated ? ids.filter((i) => p.exercises[i]?.solved).length : 0;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">Practice</p>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(solved / ids.length) * 100}%` }} />
        </div>
        <span className="text-[12px] text-fg-muted tabular-nums">
          {solved}/{ids.length}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-fg-subtle">exercises solved in this lesson</p>
    </div>
  );
}
