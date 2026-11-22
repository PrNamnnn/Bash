"use client";

import { useMemo, useState } from "react";
import { Check, X, Minus } from "lucide-react";
import { Box, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

const ALIASES: Record<string, string> = { ll: "ls -alF", grep: "grep --color=auto" };
const KEYWORDS = new Set(["if", "for", "while", "case", "function", "[["]);
const FUNCTIONS = new Set(["greet", "deploy"]);
const BUILTINS = new Set(["cd", "echo", "printf", "read", "export", "type", "test", "pwd", "source"]);
const DIRS: Record<string, string[]> = {
  "/home/learner/bin": ["backup", "deploy"],
  "/usr/local/bin": ["node", "shellcheck"],
  "/usr/bin": ["ls", "grep", "sed", "awk", "python3", "git", "echo", "printf", "test", "pwd", "find", "sort"],
  "/bin": ["bash", "sh"],
};

type Row = { label: string; state: "hit" | "miss" | "skip"; note?: string };

export default function PathLookupViz() {
  const [name, setName] = useState("python3");
  const [order, setOrder] = useState(["/home/learner/bin", "/usr/local/bin", "/usr/bin", "/bin"]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let found = false;
    const add = (label: string, hit: boolean, note?: string) => {
      if (found) out.push({ label, state: "skip" });
      else {
        out.push({ label, state: hit ? "hit" : "miss", note: hit ? note : undefined });
        if (hit) found = true;
      }
    };
    add("Alias", name in ALIASES, `alias ${name}='${ALIASES[name]}' — re-read with the alias text substituted`);
    add("Shell keyword", KEYWORDS.has(name), "a keyword is part of Bash's grammar, not a command");
    add("Function", FUNCTIONS.has(name), "a shell function defined in this session");
    add("Builtin", BUILTINS.has(name), "runs inside Bash itself, no new process");
    if (name.includes("/")) {
      add(`Path given: ${name}`, true, "contains a slash: PATH is not searched at all");
      return out;
    }
    for (const d of order) add(`PATH ▸ ${d}`, DIRS[d]?.includes(name) ?? false, `${d}/${name} is executed`);
    if (!found) out.push({ label: "Not found", state: "miss", note: `bash: ${name}: command not found (exit status 127)` });
    return out;
  }, [name, order]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  return (
    <VizFrame
      title="Command lookup and PATH"
      footer={
        <>
          Try <code className="inline-code">ll</code>, <code className="inline-code">cd</code>, <code className="inline-code">echo</code> (a builtin <em>and</em> a file in /usr/bin),{" "}
          <code className="inline-code">deploy</code> (a function shadows ~/bin/deploy), <code className="inline-code">./run.sh</code>, or move ~/bin last.
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-[12px] text-fg-subtle">
            Command name
            <input
              value={name}
              onChange={(e) => setName(e.target.value.trim())}
              spellCheck={false}
              className="mt-1 block w-full rounded-md border border-line bg-inset px-3 py-2 font-mono text-[14px] text-fg focus:border-accent/50 focus:outline-none"
            />
          </label>
          <Box title="PATH (searched left to right)">
            <code className="block font-mono text-[12px] break-all text-fg-muted">PATH={order.join(":")}</code>
            <ul className="mt-2 space-y-1">
              {order.map((d, i) => (
                <li key={d} className="flex items-center gap-2 font-mono text-[12px] text-fg-muted">
                  <span className="w-4 text-fg-subtle">{i + 1}</span>
                  <span className="flex-1 truncate">{d}</span>
                  <button type="button" onClick={() => move(i, -1)} className="rounded px-1 text-fg-subtle hover:bg-surface-3 hover:text-fg" aria-label={`Move ${d} earlier`}>
                    ↑
                  </button>
                  <button type="button" onClick={() => move(i, 1)} className="rounded px-1 text-fg-subtle hover:bg-surface-3 hover:text-fg" aria-label={`Move ${d} later`}>
                    ↓
                  </button>
                </li>
              ))}
            </ul>
          </Box>
        </div>
        <ol className="space-y-1.5" aria-live="polite">
          {rows.map((r, i) => (
            <li
              key={i}
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]",
                r.state === "hit" ? "border-accent/50 bg-accent-dim/40" : r.state === "miss" ? "border-line bg-surface-2" : "border-line/60 bg-transparent opacity-40",
              )}
            >
              <span className="mt-0.5">
                {r.state === "hit" ? <Check size={14} className="text-accent" /> : r.state === "miss" ? <X size={14} className="text-fg-subtle" /> : <Minus size={14} className="text-fg-subtle" />}
              </span>
              <span>
                <span className={cn("font-mono", r.state === "hit" ? "text-fg" : "text-fg-muted")}>{r.label}</span>
                {r.note && <span className={cn("block text-[12px]", r.label === "Not found" ? "text-red" : "text-fg-muted")}>{r.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </VizFrame>
  );
}
