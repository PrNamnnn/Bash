"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Info, RotateCcw, Eraser, CornerDownLeft } from "lucide-react";
import { ShellSession } from "@/lib/shell";
import { Ansi, stripAnsi } from "./ansi";
import { cn } from "@/lib/cn";

type EntryInput =
  | { kind: "input"; prompt: string; text: string }
  | { kind: "out"; fd: 1 | 2; text: string }
  | { kind: "info"; text: string };
type Entry = EntryInput & { id: number };

export interface TerminalProps {
  fixture?: string;
  suggestions?: string[];
  /** CSS height of the scroll area, e.g. "320px" or "100%". */
  height?: string;
  welcome?: boolean;
  autoFocus?: boolean;
  className?: string;
  title?: string;
}

const MAX_ENTRIES = 800;
let nextId = 1;
const WELCOME =
  "Simulated Bash 5.2 sandbox — runs in your browser, never on your machine. Type 'help' for supported commands, 'reset' to start over.";

function commonPrefix(list: string[]): string {
  if (!list.length) return "";
  let p = list[0];
  for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

export function Terminal({ fixture, suggestions = [], height = "340px", welcome = true, autoFocus = false, className, title }: TerminalProps) {
  const sessionRef = useRef<ShellSession | null>(null);
  const [entries, setEntries] = useState<Entry[]>(() =>
    welcome ? [{ kind: "info", id: nextId++, text: WELCOME } as Entry] : [],
  );
  const [input, setInput] = useState("");
  const [buffer, setBuffer] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("learner@bash-mastery:~$ ");
  const [cwd, setCwd] = useState("~");
  const historyRef = useRef<string[]>([]);
  const histIndex = useRef<number>(-1);
  const draftRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showInfo, setShowInfo] = useState(false);

  const session = useCallback(() => {
    sessionRef.current ??= new ShellSession(fixture);
    return sessionRef.current;
  }, [fixture]);

  const syncPrompt = useCallback(() => {
    const s = session();
    setPrompt(s.prompt());
    const home = "/home/learner";
    setCwd(s.cwd === home ? "~" : s.cwd.startsWith(home + "/") ? "~" + s.cwd.slice(home.length) : s.cwd);
  }, [session]);

  const push = useCallback((items: EntryInput[]) => {
    setEntries((prev) => {
      const next = [...prev, ...items.map((e) => ({ ...e, id: nextId++ }) as Entry)];
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  }, []);

  useEffect(() => {
    syncPrompt();
  }, [syncPrompt]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, buffer]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const execute = useCallback(
    (line: string) => {
      const s = session();
      const fullPrompt = buffer.length ? s.continuationPrompt() : s.prompt();
      const pending = [...buffer, line];
      const src = pending.join("\n");
      if (line.trim() === "reset" && !buffer.length) {
        s.reset();
        setEntries([]);
        setBuffer([]);
        push([{ kind: "info", text: "Sandbox reset: files, variables and history restored to the starting state." }]);
        syncPrompt();
        return;
      }
      push([{ kind: "input", prompt: fullPrompt, text: line }]);
      if (s.needsMore(src)) {
        setBuffer(pending);
        return;
      }
      setBuffer([]);
      if (!src.trim()) return;
      historyRef.current = [...historyRef.current.filter((h) => h !== src), src].slice(-200);
      const r = s.run(src);
      if (r.clear) setEntries([]);
      const items: EntryInput[] = [];
      if (r.echoed) items.push({ kind: "out", fd: 1, text: r.echoed + "\n" });
      for (const c of r.chunks) items.push({ kind: "out", fd: c.fd, text: c.text });
      if (items.length) push(items);
      syncPrompt();
    },
    [buffer, push, session, syncPrompt],
  );

  const runSuggestion = (cmd: string) => {
    execute(cmd);
    inputRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const s = session();
    if (e.key === "Enter") {
      e.preventDefault();
      const line = input;
      setInput("");
      histIndex.current = -1;
      execute(line);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = historyRef.current;
      if (!h.length) return;
      if (histIndex.current === -1) {
        draftRef.current = input;
        histIndex.current = h.length - 1;
      } else histIndex.current = Math.max(0, histIndex.current - 1);
      setInput(h[histIndex.current].replace(/\n/g, "; "));
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = historyRef.current;
      if (histIndex.current === -1) return;
      histIndex.current++;
      if (histIndex.current >= h.length) {
        histIndex.current = -1;
        setInput(draftRef.current);
      } else setInput(h[histIndex.current].replace(/\n/g, "; "));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const { start, candidates } = s.complete(input);
      if (!candidates.length) return;
      if (candidates.length === 1) {
        const c = candidates[0];
        setInput(input.slice(0, start) + c + (c.endsWith("/") ? "" : " "));
        return;
      }
      const prefix = commonPrefix(candidates);
      const word = input.slice(start);
      if (prefix.length > word.length) setInput(input.slice(0, start) + prefix);
      else {
        push([
          { kind: "input", prompt: buffer.length ? s.continuationPrompt() : s.prompt(), text: input },
          { kind: "out", fd: 1, text: candidates.map((c) => c.split("/").filter(Boolean).pop() + (c.endsWith("/") ? "/" : "")).join("  ") + "\n" },
        ]);
      }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      setEntries([]);
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "c") {
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      push([{ kind: "input", prompt: buffer.length ? s.continuationPrompt() : s.prompt(), text: input + "^C" }]);
      setInput("");
      setBuffer([]);
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "u") {
      e.preventDefault();
      setInput("");
    }
  };

  const currentPrompt = buffer.length ? "> " : prompt;

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border border-line-strong bg-inset", className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3f47]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3f47]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3f47]" />
        </span>
        <span className="ml-2 truncate font-mono text-[12px] text-fg-subtle">{title ?? `bash — ${cwd}`}</span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-amber/90 hover:bg-surface-3"
            aria-expanded={showInfo}
          >
            <Info size={12} /> Simulated
          </button>
          <button type="button" onClick={() => setEntries([])} className="rounded p-1 text-fg-subtle hover:bg-surface-3 hover:text-fg" aria-label="Clear screen" title="Clear screen (Ctrl+L)">
            <Eraser size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              session().reset();
              setEntries([]);
              setBuffer([]);
              historyRef.current = [];
              push([{ kind: "info", text: "Sandbox reset: files, variables and history restored to the starting state." }]);
              syncPrompt();
            }}
            className="rounded p-1 text-fg-subtle hover:bg-surface-3 hover:text-fg"
            aria-label="Reset sandbox"
            title="Reset sandbox"
          >
            <RotateCcw size={14} />
          </button>
        </span>
      </div>
      {showInfo && (
        <div className="border-b border-line bg-amber-dim/40 px-3 py-2 text-[12.5px] leading-relaxed text-fg-muted">
          This terminal is a <strong className="text-fg">Bash interpreter written in TypeScript</strong> running against a virtual filesystem in your browser.
          It supports the shell language (quoting, expansions, pipes, redirection, functions, arrays, loops) and core utilities such as ls, grep, sed, awk,
          find and sort. Commands that need a real kernel — networking, package managers, systemctl, sudo — are explained in lessons but are not available
          here.
        </div>
      )}
      <div
        ref={scrollRef}
        className="term-scroll min-h-0 flex-1 cursor-text overflow-y-auto px-3 py-2 font-mono text-[13px] leading-[1.55]"
        style={height === "100%" ? undefined : { height }}
        onMouseUp={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus({ preventScroll: true });
        }}
        role="log"
        aria-live="polite"
        aria-label="Terminal output"
      >
        {entries.map((e) =>
          e.kind === "input" ? (
            <div key={e.id} className="break-all whitespace-pre-wrap">
              <span className="text-accent">
                <Ansi text={e.prompt} />
              </span>
              <span className="text-fg">{e.text}</span>
            </div>
          ) : e.kind === "info" ? (
            <div key={e.id} className="mb-1 whitespace-pre-wrap text-fg-subtle italic">
              {e.text}
            </div>
          ) : (
            <div key={e.id} className={cn("break-words whitespace-pre-wrap", e.fd === 2 ? "text-red" : "text-[#d5d9de]")}>
              <Ansi text={e.text.endsWith("\n") ? e.text.slice(0, -1) : e.text} />
            </div>
          ),
        )}
        <div className="flex items-start">
          <span className="shrink-0 whitespace-pre text-accent">
            <Ansi text={currentPrompt} />
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-label={`Command input. Prompt: ${stripAnsi(currentPrompt)}`}
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-fg caret-accent outline-none focus-visible:outline-none"
          />
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-line bg-surface px-2 py-1.5">
          <span className="shrink-0 pl-1 text-[11px] text-fg-subtle">Try:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => runSuggestion(s)}
              className="group flex shrink-0 items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-fg-muted transition-colors hover:border-accent/40 hover:text-fg"
            >
              {s}
              <CornerDownLeft size={11} className="text-fg-subtle group-hover:text-accent" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
