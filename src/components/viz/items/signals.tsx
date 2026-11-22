"use client";

import { useState } from "react";
import { Box, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

const SIGNALS = [
  { name: "INT", num: 2, how: "Ctrl+C in the terminal", trappable: true, def: "terminate" },
  { name: "TERM", num: 15, how: "kill PID (the default signal)", trappable: true, def: "terminate" },
  { name: "HUP", num: 1, how: "terminal closed / SSH disconnected", trappable: true, def: "terminate" },
  { name: "USR1", num: 10, how: "kill -USR1 PID (application-defined)", trappable: true, def: "terminate" },
  { name: "KILL", num: 9, how: "kill -9 PID", trappable: false, def: "terminate (cannot be caught)" },
  { name: "STOP", num: 19, how: "kill -STOP PID", trappable: false, def: "pause (cannot be caught)" },
] as const;

export default function SignalsViz() {
  const [traps, setTraps] = useState<Record<string, boolean>>({ INT: true, TERM: true, EXIT: true, HUP: false, USR1: false });
  const [sent, setSent] = useState<(typeof SIGNALS)[number] | null>(null);

  const outcome = (() => {
    if (!sent) return null;
    const lines: { text: string; tone: "fg" | "accent" | "red" | "amber" }[] = [];
    if (sent.name === "STOP") {
      lines.push({ text: "Process paused by the kernel. No handler runs; send SIGCONT to resume.", tone: "amber" });
      return { lines, status: "—" };
    }
    const handled = sent.trappable && traps[sent.name];
    if (handled) {
      lines.push({ text: `trap handler for ${sent.name} runs: "echo caught ${sent.name}; cleanup; exit"`, tone: "accent" });
      if (traps.EXIT) lines.push({ text: "EXIT trap runs: rm -f \"$tmpfile\"", tone: "accent" });
      return { lines, status: `${128 + sent.num} if the handler exits with $((128+${sent.num})), or whatever status it chooses` };
    }
    if (!sent.trappable) lines.push({ text: `${sent.name} cannot be trapped or ignored. The kernel kills the process immediately.`, tone: "red" });
    else lines.push({ text: `No trap for ${sent.name}: default action — the script is terminated.`, tone: "red" });
    if (traps.EXIT && sent.trappable) lines.push({ text: "Bash still runs the EXIT trap on its way out (for signals it handles)", tone: "accent" });
    else if (traps.EXIT) lines.push({ text: "The EXIT trap does NOT run: there is no chance to clean up. Temporary files are left behind.", tone: "amber" });
    return { lines, status: `${128 + sent.num} (128 + signal number)` };
  })();

  return (
    <VizFrame title="Signals and trap" footer="Exit status 128+N means 'killed by signal N' (130 for Ctrl+C, 143 for SIGTERM, 137 for SIGKILL). Always clean up in an EXIT trap rather than duplicating code in every signal handler.">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Box title="script.sh traps">
            <ul className="space-y-1.5 font-mono text-[12px]">
              {Object.keys(traps).map((k) => (
                <li key={k}>
                  <label className="flex cursor-pointer items-center gap-2 text-fg-muted">
                    <input type="checkbox" checked={traps[k]} onChange={() => setTraps((t) => ({ ...t, [k]: !t[k] }))} className="accent-[var(--color-accent)]" />
                    <span className={traps[k] ? "text-fg" : "text-fg-subtle line-through"}>
                      trap &apos;{k === "EXIT" ? 'rm -f "$tmpfile"' : `echo caught ${k}; exit`}&apos; {k}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Box>
          <div>
            <div className="mb-1.5 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">send a signal</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {SIGNALS.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => setSent(s)}
                  className={cn("rounded-md border px-2 py-1.5 text-left transition-colors", sent?.name === s.name ? "border-accent/60 bg-accent-dim/40" : "border-line bg-surface-2 hover:border-line-strong")}
                >
                  <div className="font-mono text-[12px] text-fg">
                    SIG{s.name} <span className="text-fg-subtle">({s.num})</span>
                  </div>
                  <div className="text-[10.5px] text-fg-subtle">{s.how}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <Box title={sent ? `SIG${sent.name} delivered` : "outcome"}>
          {!outcome ? (
            <p className="text-[13px] text-fg-subtle">Choose which traps the script installs, then send it a signal.</p>
          ) : (
            <div className="space-y-2">
              {outcome.lines.map((l, i) => (
                <p key={i} className={cn("text-[13px]", l.tone === "accent" ? "text-accent" : l.tone === "red" ? "text-red" : l.tone === "amber" ? "text-amber" : "text-fg")}>
                  → {l.text}
                </p>
              ))}
              <p className="border-t border-line pt-2 font-mono text-[12px] text-fg-muted">exit status: {outcome.status}</p>
            </div>
          )}
        </Box>
      </div>
    </VizFrame>
  );
}
