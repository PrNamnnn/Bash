"use client";

import { useState } from "react";
import { VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

export default function ConditionalsViz() {
  const [usage, setUsage] = useState(72);
  const [exists, setExists] = useState(true);
  const branch = !exists ? 0 : usage >= 90 ? 1 : usage >= 75 ? 2 : 3;
  const code = [
    { t: 'if [[ ! -d "$mount" ]]; then', b: 0 },
    { t: '  echo "error: $mount missing" >&2; exit 2', b: 0, body: true },
    { t: "elif (( usage >= 90 )); then", b: 1 },
    { t: '  echo "CRITICAL: ${usage}%"', b: 1, body: true },
    { t: "elif (( usage >= 75 )); then", b: 2 },
    { t: '  echo "WARNING: ${usage}%"', b: 2, body: true },
    { t: "else", b: 3 },
    { t: '  echo "OK: ${usage}%"', b: 3, body: true },
    { t: "fi", b: -1 },
  ];
  const outputs = [`error: /data missing  (stderr, exit 2)`, `CRITICAL: ${usage}%`, `WARNING: ${usage}%`, `OK: ${usage}%`];
  const tests = [
    { label: '[[ ! -d "$mount" ]]', result: !exists },
    { label: "(( usage >= 90 ))", result: usage >= 90 },
    { label: "(( usage >= 75 ))", result: usage >= 75 },
  ];
  return (
    <VizFrame title="Conditional flow" footer="Conditions are tested top to bottom and only the first one that succeeds runs its branch. Each condition is just a command: success (exit status 0) means 'true'.">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px] text-fg-subtle">
          disk usage: <span className="font-mono text-fg">{usage}%</span>
          <input type="range" min={0} max={100} value={usage} onChange={(e) => setUsage(Number(e.target.value))} className="mt-2 block w-full accent-[var(--color-accent)]" />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-fg-muted">
          <input type="checkbox" checked={exists} onChange={(e) => setExists(e.target.checked)} className="accent-[var(--color-accent)]" />
          mount point <code className="inline-code">/data</code> exists
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <pre className="rounded-md border border-line bg-inset py-2 font-mono text-[12.5px] leading-[1.75]">
          {code.map((l, i) => (
            <div key={i} className={cn("px-3", l.body && l.b === branch && "bg-accent-dim/60 text-fg", l.body && l.b !== branch && "text-fg-subtle", !l.body && "text-fg-muted")}>
              {l.t}
            </div>
          ))}
        </pre>
        <div className="space-y-2">
          {tests.map((t, i) => {
            const reached = i <= branch || branch === 3;
            const evaluated = reached && (branch === 3 || i <= branch);
            return (
              <div key={t.label} className={cn("flex items-center justify-between rounded-md border px-3 py-1.5 font-mono text-[12px]", !evaluated ? "border-line/50 text-fg-subtle opacity-50" : t.result ? "border-accent/50 bg-accent-dim/30 text-fg" : "border-line bg-surface-2 text-fg-muted")}>
                <span>{t.label}</span>
                <span>{!evaluated ? "not evaluated" : t.result ? "true → branch runs" : "false"}</span>
              </div>
            );
          })}
          <div className="rounded-md border border-line bg-inset px-3 py-2 font-mono text-[12.5px]">
            <span className="text-fg-subtle">output: </span>
            <span className={branch === 0 || branch === 1 ? "text-red" : branch === 2 ? "text-amber" : "text-accent"}>{outputs[branch]}</span>
          </div>
        </div>
      </div>
    </VizFrame>
  );
}
