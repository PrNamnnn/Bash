"use client";

import { useState } from "react";
import { Segmented, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

type Target = "terminal" | "out.txt" | "err.txt" | "all.log" | "/dev/null" | "pipe → grep" | "keyboard" | "input.txt";

const PRESETS: { id: string; cmd: string; fd0: Target; fd1: Target; fd2: Target; note: string }[] = [
  { id: "none", cmd: "find / -name '*.conf'", fd0: "keyboard", fd1: "terminal", fd2: "terminal", note: "By default all three streams are connected to the terminal: results and errors are mixed on screen." },
  { id: ">", cmd: "find / -name '*.conf' > out.txt", fd0: "keyboard", fd1: "out.txt", fd2: "terminal", note: "Only stdout goes to the file. \"Permission denied\" errors still appear on screen because they are written to stderr." },
  { id: "2>", cmd: "find / -name '*.conf' 2> err.txt", fd0: "keyboard", fd1: "terminal", fd2: "err.txt", note: "Errors are captured in err.txt; results still print on screen." },
  { id: "2>/dev/null", cmd: "find / -name '*.conf' 2>/dev/null", fd0: "keyboard", fd1: "terminal", fd2: "/dev/null", note: "/dev/null discards anything written to it — a common way to hide expected errors. Use it deliberately: you also hide unexpected ones." },
  { id: "> 2>&1", cmd: "find / -name '*.conf' > all.log 2>&1", fd0: "keyboard", fd1: "all.log", fd2: "all.log", note: "First fd 1 points at all.log, then 2>&1 copies fd 1 into fd 2. Both streams land in the file." },
  { id: "2>&1 >", cmd: "find / -name '*.conf' 2>&1 > all.log", fd0: "keyboard", fd1: "all.log", fd2: "terminal", note: "Order matters! 2>&1 runs first, copying fd 1 (still the terminal) into fd 2. Then fd 1 is redirected to the file. Errors still reach the screen." },
  { id: "&>", cmd: "find / -name '*.conf' &> all.log", fd0: "keyboard", fd1: "all.log", fd2: "all.log", note: "&> is Bash shorthand for > file 2>&1. It is not POSIX: use the long form in /bin/sh scripts." },
  { id: "|", cmd: "find / -name '*.conf' | grep nginx", fd0: "keyboard", fd1: "pipe → grep", fd2: "terminal", note: "A pipe only carries stdout. Errors bypass grep and appear on screen. Use |& (or 2>&1 |) to pipe both." },
  { id: "<", cmd: "sort < input.txt", fd0: "input.txt", fd1: "terminal", fd2: "terminal", note: "< connects stdin to a file. sort receives the data without ever knowing a file name." },
];

const color: Record<number, string> = { 0: "text-blue border-blue/50 bg-blue-dim/40", 1: "text-accent border-accent/50 bg-accent-dim/40", 2: "text-red border-red/50 bg-red-dim/40" };

export default function StdStreamsViz() {
  const [id, setId] = useState("none");
  const p = PRESETS.find((x) => x.id === id)!;
  const rows = [
    { fd: 0, name: "stdin", dir: "in", target: p.fd0 },
    { fd: 1, name: "stdout", dir: "out", target: p.fd1 },
    { fd: 2, name: "stderr", dir: "out", target: p.fd2 },
  ];
  return (
    <VizFrame title="stdin, stdout and stderr" footer={p.note}>
      <div className="mb-4">
        <Segmented label="Redirection" value={id} onChange={setId} options={PRESETS.map((x) => ({ value: x.id, label: x.id === "none" ? "no redirect" : x.id }))} />
      </div>
      <div className="mb-4 rounded-md border border-line bg-inset px-3 py-2 font-mono text-[13px] text-fg">
        <span className="text-accent">$ </span>
        {p.cmd}
      </div>
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-lg border border-line-strong bg-surface-2 p-4 text-center">
          <div className="font-mono text-[13px] text-fg">{p.cmd.split(" ")[0]}</div>
          <div className="text-[11px] text-fg-subtle">process</div>
          <div className="mt-3 space-y-1.5">
            {rows.map((r) => (
              <div key={r.fd} className={cn("rounded border px-2 py-1 font-mono text-[12px]", color[r.fd])}>
                fd {r.fd} · {r.name}
              </div>
            ))}
          </div>
        </div>
        <div className="hidden flex-col gap-[22px] pt-12 font-mono text-[13px] text-fg-subtle sm:flex" aria-hidden>
          {rows.map((r) => (
            <span key={r.fd}>{r.dir === "in" ? "◀──────" : "──────▶"}</span>
          ))}
        </div>
        <div className="space-y-1.5 sm:pt-12">
          {rows.map((r) => (
            <div key={r.fd} className="flex items-center gap-2">
              <span className="w-14 font-mono text-[11px] text-fg-subtle">fd {r.fd}</span>
              <span
                className={cn(
                  "flex-1 rounded-md border px-2.5 py-1 font-mono text-[12.5px] transition-colors",
                  r.target === "terminal" || r.target === "keyboard" ? "border-line bg-surface-2 text-fg-muted" : r.target === "/dev/null" ? "border-line border-dashed text-fg-subtle" : "border-amber/50 bg-amber-dim/40 text-amber",
                )}
              >
                {r.target === "terminal" ? "terminal (screen)" : r.target === "keyboard" ? "terminal (keyboard)" : r.target}
              </span>
            </div>
          ))}
        </div>
      </div>
    </VizFrame>
  );
}
