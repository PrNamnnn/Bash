"use client";

import { useState } from "react";
import { Check, CircleCheck, CircleX, Eye, Lightbulb, Play, RotateCcw, Loader2 } from "lucide-react";
import type { Exercise as ExerciseT, ScriptCheck } from "@/types/content";
import { Inline } from "@/components/content/inline";
import { actions } from "@/lib/progress/store";
import { useProgress, useHydrated } from "@/lib/progress/hooks";
import { CodeEditor } from "@/components/playground/code-editor";
import { highlight, tokClass } from "@/lib/highlight";
import { cn } from "@/lib/cn";
import { DifficultyBadge } from "@/components/ui/badges";

const KIND_LABEL: Record<ExerciseT["kind"], string> = {
  mcq: "Multiple choice",
  predict: "Predict the output",
  fill: "Fill in the blanks",
  "find-bug": "Find the bug",
  command: "Write a command",
  script: "Complete the script",
};

/** Attempts before the "show solution" button unlocks. */
const REVEAL_AFTER = 2;

type Feedback = { ok: boolean; message?: string; detail?: { label: string; text: string }[] } | null;

function norm(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

function normAnswer(s: string): string {
  return s.trim().replace(/\s+/g, " ").replace(/^["']|["']$/g, "");
}

export function StaticCode({ code, className }: { code: string; className?: string }) {
  const lines = highlight(code, "bash");
  return (
    <pre className={cn("overflow-x-auto rounded-md border border-line bg-inset px-3 py-2 font-mono text-[12.5px] leading-[1.6]", className)}>
      {lines.map((toks, i) => (
        <div key={i} style={{ minHeight: "1.6em" }}>
          {toks.map((t, j) => (
            <span key={j} className={tokClass[t.t]}>
              {t.v}
            </span>
          ))}
        </div>
      ))}
    </pre>
  );
}

export function Exercise({ exercise: ex, context }: { exercise: ExerciseT; context: string }) {
  const progress = useProgress();
  const hydrated = useHydrated();
  const record = hydrated ? progress.exercises[ex.id] : undefined;
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [attempts, setAttempts] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // per-kind state
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [blanks, setBlanks] = useState<string[]>(() => (ex.kind === "fill" ? ex.blanks.map(() => "") : []));
  const [line, setLine] = useState<number | null>(null);
  const [script, setScript] = useState(ex.kind === "script" ? ex.starter : "");

  const label = `${context}: ${ex.title ?? ex.prompt.slice(0, 60)}`;
  const totalAttempts = (record?.attempts ?? 0) + 0;
  const canReveal = attempts >= REVEAL_AFTER || (record?.attempts ?? 0) >= REVEAL_AFTER || record?.solved;

  const finish = (ok: boolean, fb: Feedback) => {
    setFeedback(fb);
    setAttempts((a) => a + 1);
    actions.recordAttempt(ex.id, label, ok);
  };

  const check = async () => {
    switch (ex.kind) {
      case "mcq": {
        if (choice === null) return;
        const ok = choice === ex.answer;
        finish(ok, { ok, message: ok ? undefined : "Not quite. Re-read the options carefully — think about what Bash actually does." });
        return;
      }
      case "predict": {
        const ok = [ex.answer, ...(ex.accept ?? [])].some((a) => norm(a) === norm(text));
        finish(ok, {
          ok,
          message: ok ? undefined : "Your prediction doesn't match the real output. Trace the code step by step — every character counts, including spaces and line breaks.",
        });
        return;
      }
      case "fill": {
        const results = ex.blanks.map((acc, i) => acc.some((a) => normAnswer(a) === normAnswer(blanks[i] ?? "")));
        const ok = results.every(Boolean);
        finish(ok, {
          ok,
          message: ok ? undefined : `${results.filter((r) => !r).length} of ${results.length} blank${results.length > 1 ? "s are" : " is"} not right yet (marked in red).`,
        });
        return;
      }
      case "find-bug": {
        if (line === null) return;
        const ok = line === ex.answer;
        finish(ok, { ok, message: ok ? undefined : `Line ${line} is fine. Look again — which line would make Bash behave differently than the author intended?` });
        return;
      }
      case "command": {
        if (!text.trim()) return;
        setBusy(true);
        try {
          const { runScript, createFs } = await import("@/lib/shell");
          const base = createFs(ex.fixture);
          // Setup runs in the same shell, so `cd` and variables carry over.
          const withSetup = (code: string) => (ex.setup ? `{\n${ex.setup}\n} >/dev/null 2>&1\n${code}` : code);
          const mine = runScript({ code: withSetup(text), fs: base.clone(), interactive: true });
          const ref = runScript({ code: withSetup(ex.solution), fs: base.clone(), interactive: true });
          const mode = ex.compare ?? "stdout";
          const outOk = mode === "stderr" ? norm(mine.stderr) === norm(ref.stderr) : norm(mine.stdout) === norm(ref.stdout);
          const fsOk = mine.fs.snapshot() === ref.fs.snapshot();
          const ok = mode === "stdout" || mode === "stderr" ? outOk : mode === "fs" ? fsOk : outOk && fsOk;
          const detail: { label: string; text: string }[] = [{ label: "Your output", text: (mine.stdout + mine.stderr).replace(/\n$/, "") || "(no output)" }];
          if (!ok && mode !== "fs") detail.push({ label: "Expected output", text: ref.stdout.replace(/\n$/, "") || "(no output)" });
          finish(ok, {
            ok,
            message: ok
              ? undefined
              : mode === "fs" && outOk
                ? "The command ran, but the files on disk don't end up in the expected state."
                : mine.stderr && !mine.stdout
                  ? "Your command produced an error. Read the message below — it usually says exactly what went wrong."
                  : "The output differs from what's expected. Compare the two outputs below.",
            detail,
          });
        } finally {
          setBusy(false);
        }
        return;
      }
      case "script": {
        setBusy(true);
        try {
          const failed: ScriptCheck[] = [];
          for (const c of ex.checks ?? []) {
            const re = new RegExp(c.pattern, c.flags ?? "m");
            const hit = re.test(script);
            if (c.forbid ? hit : !hit) failed.push(c);
          }
          let detail: { label: string; text: string }[] | undefined;
          let outOk = true;
          if (ex.expectedOutput !== undefined) {
            const { runScript } = await import("@/lib/shell");
            const r = runScript({ code: script, args: ex.args, stdin: ex.stdin, fixture: ex.fixture });
            outOk = norm(r.stdout) === norm(ex.expectedOutput);
            detail = [{ label: "Your output", text: (r.stdout + r.stderr).replace(/\n$/, "") || "(no output)" }];
            if (!outOk) detail.push({ label: "Expected output", text: ex.expectedOutput || "(no output)" });
          }
          const ok = failed.length === 0 && outOk;
          finish(ok, {
            ok,
            message: ok ? undefined : failed.length ? failed.map((f) => f.message).join(" ") : "The script runs, but its output isn't what's expected.",
            detail,
          });
        } finally {
          setBusy(false);
        }
        return;
      }
    }
  };

  const retry = () => {
    setFeedback(null);
    setChoice(null);
    setText("");
    setLine(null);
    setBlanks(ex.kind === "fill" ? ex.blanks.map(() => "") : []);
    if (ex.kind === "script") setScript(ex.starter);
    setRevealed(false);
    setResetKey((k) => k + 1);
  };

  const showHint = () => {
    setHintsShown((n) => Math.min(ex.hints.length, n + 1));
    actions.useHint(ex.id);
  };

  const solved = feedback?.ok || record?.solved;
  const answered = feedback !== null;
  const disabled = (feedback?.ok ?? false) || busy;

  const solutionText = (() => {
    switch (ex.kind) {
      case "mcq":
        return ex.options[ex.answer];
      case "predict":
        return ex.answer;
      case "fill":
        return ex.template.split("___").reduce((acc, part, i) => acc + part + (i < ex.blanks.length ? ex.blanks[i][0] : ""), "");
      case "find-bug":
        return `Line ${ex.answer}. Fixed version:\n${ex.fix}`;
      case "command":
        return ex.solution;
      case "script":
        return ex.solution;
    }
  })();

  return (
    <div className={cn("my-6 rounded-lg border bg-surface", solved ? "border-accent/30" : "border-line-strong")} data-exercise={ex.id}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[12px] font-medium text-fg-muted">{KIND_LABEL[ex.kind]}</span>
        <DifficultyBadge level={ex.difficulty} />
        {ex.kind === "command" && <span className="rounded bg-amber-dim px-1.5 py-0.5 text-[10.5px] text-amber">runs in the simulator</span>}
        {solved && (
          <span className="ml-auto flex items-center gap-1 text-[12px] text-accent">
            <CircleCheck size={14} /> Solved
          </span>
        )}
        {!solved && hydrated && totalAttempts > 0 && <span className="ml-auto text-[11.5px] text-fg-subtle">{totalAttempts} attempt{totalAttempts > 1 ? "s" : ""}</span>}
      </div>

      <div className="space-y-3 px-4 py-4">
        {ex.title && <h4 className="text-[15px] font-semibold text-fg">{ex.title}</h4>}
        {ex.scenario && (
          <p className="rounded-md border-l-2 border-blue/50 bg-blue-dim/30 px-3 py-2 text-[13.5px] text-fg-muted">
            <Inline text={ex.scenario} />
          </p>
        )}
        <div className="prose-lesson text-[14.5px]">
          <Inline text={ex.prompt} />
        </div>

        {ex.code && ex.kind !== "find-bug" && <StaticCode code={ex.code} />}

        {/* kind-specific interaction */}
        {ex.kind === "mcq" && (
          <fieldset className="space-y-1.5" disabled={disabled}>
            <legend className="sr-only">Choose one answer</legend>
            {ex.options.map((o, i) => {
              const isAnswer = answered && feedback?.ok && i === ex.answer;
              const isWrong = answered && !feedback?.ok && choice === i;
              return (
                <label
                  key={i}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-[14px] transition-colors",
                    choice === i ? "border-accent/50 bg-accent-dim/30" : "border-line hover:border-line-strong hover:bg-surface-2",
                    isAnswer && "border-accent bg-accent-dim/50",
                    isWrong && "border-red/60 bg-red-dim/40",
                    revealed && i === ex.answer && "border-accent",
                  )}
                >
                  <input type="radio" name={`${ex.id}-${resetKey}`} className="mt-1 accent-[var(--color-accent)]" checked={choice === i} onChange={() => setChoice(i)} />
                  <span className="text-fg-muted">
                    <Inline text={o} />
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        {ex.kind === "predict" && (
          <label className="block">
            <span className="text-[12px] text-fg-subtle">Type exactly what Bash prints:</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={disabled}
              rows={Math.min(8, Math.max(2, ex.answer.split("\n").length + 1))}
              spellCheck={false}
              className="mt-1 block w-full resize-y rounded-md border border-line bg-inset px-3 py-2 font-mono text-[13px] text-fg focus:border-accent/50 focus:outline-none"
            />
          </label>
        )}

        {ex.kind === "fill" && (
          <div className="overflow-x-auto rounded-md border border-line bg-inset px-3 py-3 font-mono text-[13px] leading-[2.1] whitespace-pre">
            {ex.template.split("___").map((part, i, arr) => (
              <span key={i}>
                <span className="text-fg">{part}</span>
                {i < arr.length - 1 && (
                  <input
                    value={blanks[i] ?? ""}
                    onChange={(e) => setBlanks((b) => b.map((x, j) => (j === i ? e.target.value : x)))}
                    disabled={disabled}
                    aria-label={`Blank ${i + 1}`}
                    spellCheck={false}
                    size={Math.max(4, Math.max(...ex.blanks[i].map((a) => a.length)) + 1)}
                    className={cn(
                      "mx-0.5 rounded border bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-accent focus:outline-none",
                      answered && !feedback?.ok && !ex.blanks[i].some((a) => normAnswer(a) === normAnswer(blanks[i] ?? "")) ? "border-red/70" : "border-line-strong focus:border-accent/60",
                    )}
                  />
                )}
              </span>
            ))}
          </div>
        )}

        {ex.kind === "find-bug" && ex.code && (
          <div className="overflow-x-auto rounded-md border border-line bg-inset py-2 font-mono text-[12.5px] leading-[1.7]">
            <p className="px-3 pb-1 font-sans text-[11.5px] text-fg-subtle">Click the line that contains the bug:</p>
            {highlight(ex.code, "bash").map((toks, i) => (
              <button
                type="button"
                key={i}
                disabled={disabled}
                onClick={() => setLine(i + 1)}
                className={cn(
                  "flex w-full items-start gap-3 px-3 text-left whitespace-pre",
                  line === i + 1 ? "bg-accent-dim/50" : "hover:bg-surface-2",
                  answered && feedback?.ok && ex.answer === i + 1 && "bg-accent-dim",
                  answered && !feedback?.ok && line === i + 1 && "bg-red-dim/60",
                )}
                aria-pressed={line === i + 1}
              >
                <span className="w-6 shrink-0 text-right text-fg-subtle select-none">{i + 1}</span>
                <span>
                  {toks.map((t, j) => (
                    <span key={j} className={tokClass[t.t]}>
                      {t.v}
                    </span>
                  ))}
                  {!toks.length && " "}
                </span>
              </button>
            ))}
          </div>
        )}

        {ex.kind === "command" && (
          <div className="flex items-center gap-2 rounded-md border border-line bg-inset px-3 py-2 font-mono text-[13px] focus-within:border-accent/50">
            <span className="text-accent select-none">$</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !disabled && check()}
              disabled={disabled}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-label="Your command"
              placeholder="type your command…"
              className="min-w-0 flex-1 bg-transparent text-fg placeholder:text-fg-subtle focus:outline-none"
            />
          </div>
        )}

        {ex.kind === "script" && (
          <div className="overflow-hidden rounded-md border border-line">
            <CodeEditor key={resetKey} value={script} onChange={setScript} onRun={check} ariaLabel="Your script" minLines={Math.max(4, ex.starter.split("\n").length)} />
          </div>
        )}

        {/* hints */}
        {hintsShown > 0 && (
          <ul className="space-y-1.5">
            {ex.hints.slice(0, hintsShown).map((h, i) => (
              <li key={i} className="flex gap-2 rounded-md bg-amber-dim/40 px-3 py-2 text-[13.5px] text-fg-muted">
                <Lightbulb size={14} className="mt-0.5 shrink-0 text-amber" />
                <span>
                  <span className="text-amber">Hint {i + 1}:</span> <Inline text={h} />
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* feedback */}
        {feedback && (
          <div
            role="status"
            className={cn("rounded-md border px-3 py-2.5 text-[13.5px]", feedback.ok ? "border-accent/40 bg-accent-dim/40" : "border-red/40 bg-red-dim/40")}
          >
            <p className={cn("flex items-center gap-1.5 font-medium", feedback.ok ? "text-accent" : "text-red")}>
              {feedback.ok ? <CircleCheck size={15} /> : <CircleX size={15} />}
              {feedback.ok ? "Correct!" : "Not yet"}
            </p>
            {feedback.message && (
              <p className="mt-1 text-fg-muted">
                <Inline text={feedback.message} />
              </p>
            )}
            {feedback.detail && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {feedback.detail.map((d) => (
                  <div key={d.label}>
                    <div className="mb-1 text-[11px] text-fg-subtle uppercase">{d.label}</div>
                    <pre className="max-h-48 overflow-auto rounded border border-line bg-inset px-2 py-1.5 font-mono text-[12px] whitespace-pre-wrap text-fg-muted">{d.text}</pre>
                  </div>
                ))}
              </div>
            )}
            {feedback.ok && (
              <div className="prose-lesson mt-2 border-t border-accent/20 pt-2 text-[14px]">
                <Inline text={ex.explanation} />
              </div>
            )}
          </div>
        )}

        {revealed && !feedback?.ok && (
          <div className="rounded-md border border-violet/40 bg-violet-dim/30 px-3 py-2.5 text-[13.5px]">
            <p className="mb-1.5 font-medium text-violet">Solution</p>
            {ex.kind === "mcq" ? (
              <p className="text-fg-muted">
                <Inline text={solutionText} />
              </p>
            ) : (
              <StaticCode code={solutionText} />
            )}
            <div className="prose-lesson mt-2 text-[14px]">
              <Inline text={ex.explanation} />
            </div>
          </div>
        )}

        {/* actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!feedback?.ok && (
            <button
              type="button"
              onClick={check}
              disabled={busy || (ex.kind === "mcq" && choice === null) || (ex.kind === "find-bug" && line === null)}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : ex.kind === "command" || ex.kind === "script" ? <Play size={13} fill="currentColor" /> : <Check size={14} />}
              {ex.kind === "command" ? "Run & check" : "Check answer"}
            </button>
          )}
          {(feedback || revealed) && (
            <button type="button" onClick={retry} className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-fg-muted hover:border-line-strong hover:text-fg">
              <RotateCcw size={13} /> {feedback?.ok ? "Try again" : "Reset"}
            </button>
          )}
          {ex.hints.length > 0 && hintsShown < ex.hints.length && !feedback?.ok && (
            <button type="button" onClick={showHint} className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-amber hover:bg-amber-dim/40">
              <Lightbulb size={13} /> Hint {ex.hints.length > 1 ? `(${hintsShown + 1}/${ex.hints.length})` : ""}
            </button>
          )}
          {!feedback?.ok && !revealed && (
            <button
              type="button"
              onClick={() => {
                setRevealed(true);
                actions.reveal(ex.id);
              }}
              disabled={!canReveal}
              title={canReveal ? "Show the solution" : `Make at least ${REVEAL_AFTER} attempts first`}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-fg-subtle hover:text-fg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Eye size={13} /> {canReveal ? "Show solution" : `Solution unlocks after ${REVEAL_AFTER} attempts`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
