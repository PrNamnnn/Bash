"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Lightbulb, Play, RotateCcw, Info, ChevronDown } from "lucide-react";
import { CodeEditor } from "./code-editor";
import { runScript, syntaxCheck, type OutChunk } from "@/lib/shell";
import { explainCode } from "@/lib/explain";
import { Ansi } from "@/components/terminal/ansi";
import { cn } from "@/lib/cn";

export interface PlaygroundProps {
  code: string;
  title?: string;
  notes?: Record<number, string>;
  fixture?: string;
  args?: string;
  stdin?: string;
  /** Show args/stdin inputs. */
  showInputs?: boolean;
  minLines?: number;
  className?: string;
  /** Run once immediately after mounting. */
  autoRun?: boolean;
}

interface Result {
  chunks: OutChunk[];
  status: number;
  ms: number;
  aborted?: string;
}

export function Playground({ code: initial, title = "script.sh", notes, fixture, args: initialArgs = "", stdin: initialStdin = "", showInputs = true, minLines = 6, className, autoRun = false }: PlaygroundProps) {
  const [code, setCode] = useState(initial);
  const [args, setArgs] = useState(initialArgs);
  const [stdin, setStdin] = useState(initialStdin);
  const [result, setResult] = useState<Result | null>(null);
  const [syntax, setSyntax] = useState<{ message: string; line: number } | null>(null);
  const [explain, setExplain] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(Boolean(initialArgs || initialStdin));
  const [activeLine, setActiveLine] = useState<number | undefined>();

  const run = useCallback(() => {
    const err = syntaxCheck(code);
    setSyntax(err);
    if (err) {
      setResult(null);
      return;
    }
    const t0 = performance.now();
    const r = runScript({ code, args, stdin, fixture, tty: true, name: title });
    setResult({ chunks: r.chunks, status: r.status, ms: performance.now() - t0, aborted: r.aborted });
  }, [code, args, stdin, fixture, title]);

  const ranOnce = useRef(false);
  useEffect(() => {
    if (autoRun && !ranOnce.current) {
      ranOnce.current = true;
      run();
    }
  }, [autoRun, run]);

  const explanations = useMemo(() => (explain ? explainCode(code, code === initial ? notes : undefined) : []), [explain, code, initial, notes]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const btn = "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors";

  return (
    <div className={cn("overflow-hidden rounded-lg border border-line-strong bg-surface", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="px-1.5 font-mono text-[12px] text-fg-muted">{title}</span>
        <span className="rounded bg-amber-dim px-1.5 py-0.5 text-[10.5px] text-amber" title="Runs in the in-browser Bash simulator">
          simulated
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setExplain((v) => !v)} className={cn(btn, explain ? "bg-violet-dim text-violet" : "text-fg-muted hover:bg-surface-3 hover:text-fg")} aria-pressed={explain}>
            <Lightbulb size={13} /> Explain
          </button>
          <button type="button" onClick={copy} className={cn(btn, "text-fg-muted hover:bg-surface-3 hover:text-fg")} aria-label="Copy code">
            {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setCode(initial);
              setArgs(initialArgs);
              setStdin(initialStdin);
              setResult(null);
              setSyntax(null);
            }}
            className={cn(btn, "text-fg-muted hover:bg-surface-3 hover:text-fg")}
            aria-label="Reset to the original example"
          >
            <RotateCcw size={13} />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button type="button" onClick={run} className={cn(btn, "bg-accent font-medium text-accent-fg hover:bg-accent-strong")} title="Run (Ctrl+Enter)">
            <Play size={13} fill="currentColor" /> Run
          </button>
        </div>
      </div>

      <CodeEditor
        value={code}
        onChange={setCode}
        onRun={run}
        ariaLabel={`Editable Bash code: ${title}`}
        minLines={minLines}
        errorLine={syntax?.line}
        highlightLine={explain ? activeLine : undefined}
        onLineClick={explain ? setActiveLine : undefined}
      />

      {showInputs && (
        <div className="border-t border-line">
          <button type="button" onClick={() => setInputsOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[12px] text-fg-subtle hover:text-fg-muted" aria-expanded={inputsOpen}>
            <ChevronDown size={13} className={cn("transition-transform", !inputsOpen && "-rotate-90")} />
            Arguments &amp; standard input
            {(args || stdin) && !inputsOpen && <span className="ml-1 text-accent">●</span>}
          </button>
          {inputsOpen && (
            <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
              <label className="block text-[11.5px] text-fg-subtle">
                Arguments ($1, $2, …)
                <input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder={`e.g. alice "two words"`}
                  className="mt-1 block w-full rounded-md border border-line bg-inset px-2 py-1.5 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent/50 focus:outline-none"
                />
              </label>
              <label className="block text-[11.5px] text-fg-subtle">
                Standard input
                <textarea
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  rows={2}
                  placeholder="Text the script reads with read / cat"
                  className="mt-1 block w-full resize-y rounded-md border border-line bg-inset px-2 py-1.5 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent/50 focus:outline-none"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {explain && (
        <div className="max-h-72 overflow-y-auto border-t border-line bg-violet-dim/20 px-3 py-2">
          <p className="mb-2 flex items-center gap-1.5 text-[11.5px] text-violet">
            <Info size={12} /> Line-by-line explanation {code === initial && notes ? "(written by the course authors)" : "(generated from the constructs on each line)"}
          </p>
          <ol className="space-y-1.5">
            {explanations.map((x) => (
              <li
                key={x.line}
                className={cn("grid cursor-pointer grid-cols-[2.2rem_1fr] gap-2 rounded px-1 py-0.5 text-[13px] leading-relaxed", activeLine === x.line ? "bg-violet-dim/60" : "hover:bg-violet-dim/30")}
                onMouseEnter={() => setActiveLine(x.line)}
              >
                <span className="pt-0.5 text-right font-mono text-[11.5px] text-fg-subtle">{x.line}</span>
                <span className="text-fg-muted">
                  <InlineTicks text={x.text} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {syntax && (
        <div className="border-t border-line bg-red-dim/50 px-3 py-2 font-mono text-[12.5px] text-red" role="alert">
          Syntax error on line {syntax.line}: {syntax.message}
        </div>
      )}

      {result && (
        <div className="border-t border-line bg-inset" aria-live="polite">
          <div className="flex items-center gap-3 border-b border-line px-3 py-1 text-[11px] text-fg-subtle">
            <span>Output</span>
            <span className={cn("font-mono", result.status === 0 ? "text-accent" : "text-red")}>exit {result.status}</span>
            <span className="ml-auto tabular-nums">{result.ms < 1 ? "<1" : Math.round(result.ms)} ms</span>
          </div>
          <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[12.5px] leading-[1.55] whitespace-pre-wrap">
            {result.chunks.length === 0 && <span className="text-fg-subtle italic">(no output)</span>}
            {result.chunks.map((c, i) => (
              <span key={i} className={c.fd === 2 ? "text-red" : "text-[#d5d9de]"}>
                <Ansi text={c.text} />
              </span>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Render `code` spans in explanation strings. */
export function InlineTicks({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="inline-code">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
