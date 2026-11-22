"use client";

import { useState } from "react";
import { Segmented, StepControls, useStepper, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

type Table = Record<number, string>;

interface Op {
  text: string;
  apply: (t: Table) => Table;
  explain: string;
}

const START: Table = { 0: "terminal", 1: "terminal", 2: "terminal" };

const SCENARIOS: Record<string, { cmd: string; ops: Op[] }> = {
  good: {
    cmd: "cmd > out.log 2>&1",
    ops: [
      { text: "> out.log", apply: (t) => ({ ...t, 1: "out.log" }), explain: "Open out.log for writing (truncating it) and point fd 1 at it." },
      { text: "2>&1", apply: (t) => ({ ...t, 2: t[1] }), explain: "Make fd 2 a copy of whatever fd 1 points to right now — out.log." },
    ],
  },
  bad: {
    cmd: "cmd 2>&1 > out.log",
    ops: [
      { text: "2>&1", apply: (t) => ({ ...t, 2: t[1] }), explain: "Make fd 2 a copy of fd 1 — which is still the terminal." },
      { text: "> out.log", apply: (t) => ({ ...t, 1: "out.log" }), explain: "Now point fd 1 at out.log. fd 2 is unaffected: it kept its own copy of the terminal." },
    ],
  },
  swap: {
    cmd: "cmd 3>&1 1>&2 2>&3 3>&-",
    ops: [
      { text: "3>&1", apply: (t) => ({ ...t, 3: t[1] }), explain: "Save stdout's target in a spare descriptor, fd 3." },
      { text: "1>&2", apply: (t) => ({ ...t, 1: t[2] }), explain: "Point stdout where stderr points." },
      { text: "2>&3", apply: (t) => ({ ...t, 2: t[3] }), explain: "Point stderr at the saved original stdout." },
      { text: "3>&-", apply: (t) => { const n = { ...t }; delete n[3]; return n; }, explain: "Close fd 3 so the command doesn't inherit it." },
    ],
  },
  pipe: {
    cmd: "cmd 2>&1 | grep error",
    ops: [
      { text: "|", apply: (t) => ({ ...t, 1: "pipe → grep" }), explain: "Pipes are set up first: fd 1 of cmd is connected to the pipe before any redirections." },
      { text: "2>&1", apply: (t) => ({ ...t, 2: t[1] }), explain: "fd 2 copies fd 1 — the pipe — so grep sees both streams." },
    ],
  },
};

export default function FdFlowViz() {
  const [key, setKey] = useState<keyof typeof SCENARIOS>("good");
  const sc = SCENARIOS[key];
  const s = useStepper(sc.ops.length + 1, [key]);
  const tables: Table[] = [START];
  for (const op of sc.ops) tables.push(op.apply(tables[tables.length - 1]));
  const table = tables[s.step];
  const prev = s.step > 0 ? tables[s.step - 1] : null;
  const fds = Object.keys({ ...START, ...table, ...(prev ?? {}) })
    .map(Number)
    .sort();

  return (
    <VizFrame title="File descriptor table, step by step" footer="Redirections are processed strictly left to right. `n>&m` copies where fd m points at that moment — it is not a permanent link.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Scenario"
          value={key}
          onChange={setKey}
          options={[
            { value: "good", label: "> f 2>&1" },
            { value: "bad", label: "2>&1 > f" },
            { value: "pipe", label: "2>&1 |" },
            { value: "swap", label: "swap 1↔2" },
          ]}
        />
        <StepControls {...s} count={sc.ops.length + 1} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-md border border-line bg-inset px-3 py-2 font-mono text-[13px]">
        <span className="text-accent">$ </span>
        <span className="text-fg">cmd</span>
        {sc.ops.map((op, i) => (
          <span key={i} className={cn("rounded px-1", i === s.step - 1 ? "bg-amber-dim text-amber" : i < s.step - 1 ? "text-fg-muted" : "text-fg-subtle")}>
            {op.text === "|" ? "| grep error" : op.text}
          </span>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div>
          <table className="w-full border-collapse font-mono text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-fg-subtle">
                <th className="border-b border-line py-1.5 pr-3 font-medium">fd</th>
                <th className="border-b border-line py-1.5 font-medium">points to</th>
              </tr>
            </thead>
            <tbody>
              {fds.map((fd) => {
                const changed = prev && prev[fd] !== table[fd];
                return (
                  <tr key={fd}>
                    <td className="border-b border-line/60 py-1.5 pr-3 text-fg-muted">
                      {fd} <span className="text-fg-subtle">{fd === 0 ? "stdin" : fd === 1 ? "stdout" : fd === 2 ? "stderr" : ""}</span>
                    </td>
                    <td className={cn("border-b border-line/60 py-1.5 transition-colors", changed ? "text-amber" : table[fd] ? "text-fg" : "text-fg-subtle line-through")}>{table[fd] ?? "closed"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[13.5px] leading-relaxed text-fg-muted">
          {s.step === 0 ? "Before any redirection, the command inherits the shell's descriptors: all three point at the terminal." : sc.ops[s.step - 1].explain}
          {s.step === sc.ops.length && (
            <span className="mt-2 block text-fg">
              Result: stdout → <b>{table[1]}</b>, stderr → <b>{table[2]}</b>.
            </span>
          )}
        </p>
      </div>
    </VizFrame>
  );
}
