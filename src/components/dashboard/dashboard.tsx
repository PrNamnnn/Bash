"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Award, BookOpen, Bookmark, Box, Download, Flame, FlaskConical, NotebookPen, RotateCcw, TriangleExclamationPoint, Upload } from "lucide-react";
import type { LevelMeta, ProjectMeta, SkillArea } from "@/types/content";
import { useHydrated, useProgress } from "@/lib/progress/hooks";
import { actions, computeStreak, consumeLoadWarning, exportState, localDay } from "@/lib/progress/store";
import { cn } from "@/lib/cn";

const SKILL_LABEL: Record<SkillArea, string> = {
  foundations: "Foundations",
  commands: "Core commands",
  "shell-language": "Shell language",
  io: "I/O & redirection",
  "text-processing": "Text processing",
  scripting: "Scripting",
  internals: "Shell internals",
  engineering: "Engineering",
  operations: "Ops & DevOps",
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function Stat({ label, value, sub, icon: Icon, tone = "fg" }: { label: string; value: string; sub?: string; icon: typeof Flame; tone?: "fg" | "accent" | "amber" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
        <Icon size={14} className={tone === "accent" ? "text-accent" : tone === "amber" ? "text-amber" : "text-fg-subtle"} />
        {label}
      </div>
      <div className="mt-2 text-[26px] leading-none font-semibold text-fg tabular-nums">{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-fg-subtle">{sub}</div>}
    </div>
  );
}

function Heatmap({ days }: { days: string[] }) {
  const set = new Set(days);
  const weeks = 18;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (weeks * 7 - 1) - today.getDay());
  const cells: { day: string; active: boolean; future: boolean }[] = [];
  for (let i = 0; i < weeks * 7 + today.getDay() + 1; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ day: localDay(d), active: set.has(localDay(d)), future: d > today });
  }
  const columns: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7));
  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1" role="img" aria-label={`Learning activity over the last ${weeks} weeks: ${days.length} active days`}>
      {columns.map((col, i) => (
        <div key={i} className="flex flex-col gap-[3px]">
          {col.map((c) => (
            <span key={c.day} title={`${c.day}${c.active ? " — studied" : ""}`} className={cn("h-[11px] w-[11px] rounded-[2px]", c.future ? "bg-transparent" : c.active ? "bg-accent" : "bg-surface-3")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Dashboard({ levels, projects }: { levels: LevelMeta[]; projects: ProjectMeta[] }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => {
    // Surface a one-time message if stored progress had to be repaired.
    const w = consumeLoadWarning();
    if (w) queueMicrotask(() => setWarning(w));
  }, []);

  const flat = useMemo(() => levels.flatMap((l) => l.modules.flatMap((m) => m.lessons.map((x) => ({ ...x, level: l })))), [levels]);
  const done = hydrated ? flat.filter((l) => p.lessons[l.slug]) : [];
  const pct = Math.round((done.length / flat.length) * 100);
  const minutes = done.reduce((s, l) => s + l.minutes, 0);
  const streak = hydrated ? computeStreak(p.activityDays) : { current: 0, longest: 0 };
  const exRecords = hydrated ? Object.values(p.exercises) : [];
  const solved = exRecords.filter((e) => e.solved).length;
  const attempted = exRecords.filter((e) => e.attempts > 0).length;
  const firstTry = exRecords.filter((e) => e.solved && e.attempts === 1 && !e.revealed).length;

  const nextLesson = flat.find((l) => !p.lessons[l.slug]);
  const last = hydrated && p.lastLesson ? flat.find((l) => l.slug === p.lastLesson!.slug) : undefined;
  const continueWith = last && !p.lessons[last.slug] ? last : nextLesson;
  const currentLevel = continueWith?.level ?? levels[levels.length - 1];

  const skills = useMemo(() => {
    const map = new Map<SkillArea, { total: number; done: number }>();
    for (const l of flat) {
      const s = map.get(l.level.skill) ?? { total: 0, done: 0 };
      s.total++;
      if (hydrated && p.lessons[l.slug]) s.done++;
      map.set(l.level.skill, s);
    }
    return [...map.entries()];
  }, [flat, p.lessons, hydrated]);

  const bookmarks = hydrated ? p.bookmarks : [];
  const notes = hydrated ? Object.entries(p.notes).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt)) : [];
  const labelFor = (key: string) => {
    const [kind, slug] = key.split(":");
    if (kind === "lesson") return { title: flat.find((l) => l.slug === slug)?.title ?? slug, href: `/learn/${slug}` };
    if (kind === "project") return { title: projects.find((x) => x.slug === slug)?.title ?? slug, href: `/projects/${slug}` };
    return { title: key, href: "/dashboard" };
  };

  return (
    <div className="space-y-8">
      {warning && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber/40 bg-amber-dim/40 px-4 py-3 text-[13.5px] text-fg-muted">
          <TriangleExclamationPoint size={16} className="mt-0.5 shrink-0 text-amber" /> {warning}
        </div>
      )}

      <header className="flex flex-col gap-5 md:flex-row md:items-end">
        <div className="flex-1">
          <p className="mb-2 font-mono text-[12px] text-accent">~/dashboard</p>
          <h1 className="text-[30px] font-semibold tracking-tight text-fg">{hydrated && done.length ? "Welcome back" : "Your learning dashboard"}</h1>
          <p className="mt-1.5 text-[15px] text-fg-muted">
            {hydrated && done.length
              ? `You're working through Level ${currentLevel.number}: ${currentLevel.title}.`
              : "Everything here is computed from what you actually do — nothing is made up. Complete a lesson or solve an exercise to get started."}
          </p>
        </div>
        {continueWith && (
          <Link href={`/learn/${continueWith.slug}`} className="group flex items-center gap-4 rounded-xl border border-accent/30 bg-accent-dim/20 px-5 py-4 transition-colors hover:border-accent/60 md:w-[420px]">
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-medium tracking-wide text-accent uppercase">{last && continueWith === last ? "Continue where you left off" : done.length ? "Up next" : "Start here"}</span>
              <span className="mt-0.5 block truncate text-[15px] font-medium text-fg">{continueWith.title}</span>
              <span className="block text-[12px] text-fg-subtle">
                Level {continueWith.level.number} · {continueWith.minutes} min
              </span>
            </span>
            <ArrowRight size={18} className="text-accent transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </header>

      <section aria-label="Statistics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Course progress" value={`${pct}%`} sub={`${done.length} of ${flat.length} lessons`} icon={BookOpen} tone="accent" />
        <Stat label="Current streak" value={`${streak.current} day${streak.current === 1 ? "" : "s"}`} sub={`longest: ${streak.longest} day${streak.longest === 1 ? "" : "s"}`} icon={Flame} tone="amber" />
        <Stat label="Exercises solved" value={String(solved)} sub={attempted ? `${firstTry} on the first try · ${attempted} attempted` : "none attempted yet"} icon={FlaskConical} />
        <Stat label="Study time" value={minutes >= 60 ? `${(minutes / 60).toFixed(1)} h` : `${minutes} min`} sub="estimated from completed lessons" icon={Award} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="mb-4 text-[14px] font-semibold text-fg">Progress by level</h2>
          <ul className="space-y-2.5">
            {levels.map((l) => {
              const ls = l.modules.flatMap((m) => m.lessons);
              const d = hydrated ? ls.filter((x) => p.lessons[x.slug]).length : 0;
              return (
                <li key={l.id}>
                  <Link href={`/learn#${l.id}`} className="group grid grid-cols-[2rem_1fr_auto] items-center gap-3">
                    <span className="font-mono text-[12px] text-fg-subtle">{String(l.number).padStart(2, "0")}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-fg-muted group-hover:text-fg">{l.title}</span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(d / ls.length) * 100}%` }} />
                      </span>
                    </span>
                    <span className="font-mono text-[11.5px] text-fg-subtle tabular-nums">
                      {d}/{ls.length}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-[14px] font-semibold text-fg">Activity</h2>
            {hydrated ? <Heatmap days={p.activityDays} /> : <div className="h-[95px] rounded bg-surface-2/40" aria-hidden="true" />}
            <p className="mt-2 text-[12px] text-fg-subtle">A day counts when you complete a lesson, attempt an exercise, work on a project or write a note.</p>
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-[14px] font-semibold text-fg">Skill breakdown</h2>
            <ul className="space-y-2">
              {skills.map(([skill, s]) => (
                <li key={skill} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-3 text-[12.5px]">
                  <span className="text-fg-muted">{SKILL_LABEL[skill]}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full rounded-full bg-violet" style={{ width: `${(s.done / s.total) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono text-[11px] text-fg-subtle">{Math.round((s.done / s.total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-line bg-surface p-5 lg:col-span-1">
          <h2 className="mb-3 text-[14px] font-semibold text-fg">Recent activity</h2>
          {hydrated && p.recent.length ? (
            <ul className="space-y-2">
              {p.recent.slice(0, 10).map((e) => (
                <li key={`${e.type}-${e.id}-${e.at}`} className="flex items-start gap-2 text-[13px]">
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", e.type === "lesson" ? "bg-accent" : e.type === "exercise" ? "bg-blue" : e.type === "project" ? "bg-violet" : "bg-amber")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg-muted">{e.type === "lesson" ? "Completed " : e.type === "exercise" ? "Practised " : e.type === "project" ? "Worked on " : "Notes on "}<span className="text-fg">{e.label}</span></span>
                    <span className="text-[11.5px] text-fg-subtle">{relTime(e.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-subtle">Nothing yet — your activity will appear here.</p>
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-fg">
            <Box size={15} className="text-violet" /> Projects
          </h2>
          <ul className="space-y-2">
            {projects.map((pr) => {
              const rec = hydrated ? p.projects[pr.slug] : undefined;
              const state = rec?.completedAt ? "done" : rec?.steps.length ? "active" : "todo";
              return (
                <li key={pr.slug}>
                  <Link href={`/projects/${pr.slug}`} className="flex items-center gap-2 text-[13px] text-fg-muted hover:text-fg">
                    <span className="w-5 font-mono text-[11px] text-fg-subtle">{pr.number}</span>
                    <span className="min-w-0 flex-1 truncate">{pr.title}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10.5px]", state === "done" ? "bg-accent-dim text-accent" : state === "active" ? "bg-violet-dim text-violet" : "text-fg-subtle")}>
                      {state === "done" ? "done" : state === "active" ? `${rec!.steps.length} steps` : "—"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-5 rounded-xl border border-line bg-surface p-5">
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-fg">
              <Bookmark size={15} className="text-amber" /> Bookmarks
            </h2>
            {bookmarks.length ? (
              <ul className="space-y-1.5">
                {bookmarks.map((b) => {
                  const l = labelFor(b);
                  return (
                    <li key={b}>
                      <Link href={l.href} className="block truncate text-[13px] text-fg-muted hover:text-accent">
                        {l.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-fg-subtle">Bookmark lessons to find them here.</p>
            )}
          </div>
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-fg">
              <NotebookPen size={15} className="text-blue" /> Notes
            </h2>
            {notes.length ? (
              <ul className="space-y-2">
                {notes.slice(0, 6).map(([key, n]) => {
                  const l = labelFor(key);
                  return (
                    <li key={key}>
                      <Link href={l.href} className="block rounded-md border border-line px-3 py-2 hover:border-line-strong">
                        <span className="block truncate text-[12.5px] text-fg">{l.title}</span>
                        <span className="line-clamp-2 block text-[12px] text-fg-subtle">{n.text}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-fg-subtle">Notes you write in lessons appear here.</p>
            )}
          </div>
        </section>
      </div>

      <DataPanel />
    </div>
  );
}

function DataPanel() {
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([exportState()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bash-mastery-progress-${localDay()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section id="data" className="scroll-mt-24 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-[14px] font-semibold text-fg">Your data</h2>
      <p className="mt-1 text-[13px] text-fg-muted">
        Progress, notes and bookmarks are stored only in this browser (localStorage). Export a backup to move them to another device.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={download} className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-fg-muted hover:border-line-strong hover:text-fg">
          <Download size={14} /> Export JSON
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-fg-muted hover:border-line-strong hover:text-fg">
          <Upload size={14} /> Import JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              actions.importState(JSON.parse(await f.text()));
              setMsg({ ok: true, text: "Progress imported." });
            } catch {
              setMsg({ ok: false, text: "That file isn't a valid Bash Mastery export." });
            }
          }}
        />
        <button type="button" onClick={() => setConfirm(true)} className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-red/40 px-3 text-[13px] text-red hover:bg-red-dim/40">
          <RotateCcw size={14} /> Reset all progress
        </button>
      </div>
      {msg && <p className={cn("mt-3 text-[13px]", msg.ok ? "text-accent" : "text-red")}>{msg.text}</p>}
      {confirm && (
        <div role="alertdialog" aria-labelledby="reset-title" className="mt-4 rounded-lg border border-red/40 bg-red-dim/30 p-4">
          <p id="reset-title" className="text-[14px] font-medium text-fg">
            Delete all progress, notes and bookmarks?
          </p>
          <p className="mt-1 text-[13px] text-fg-muted">This cannot be undone. Export a backup first if you might want it back. Type <b className="font-mono text-fg">RESET</b> to confirm.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type RESET to confirm" className="h-8 w-32 rounded-md border border-line bg-inset px-2 font-mono text-[13px] text-fg focus:outline-none" />
            <button
              type="button"
              disabled={typed !== "RESET"}
              onClick={() => {
                actions.resetAll();
                setConfirm(false);
                setTyped("");
                setMsg({ ok: true, text: "All progress has been reset." });
              }}
              className="h-8 rounded-md bg-red px-3 text-[13px] font-medium text-bg disabled:opacity-40"
            >
              Delete everything
            </button>
            <button type="button" onClick={() => { setConfirm(false); setTyped(""); }} className="h-8 rounded-md px-3 text-[13px] text-fg-muted hover:text-fg">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
