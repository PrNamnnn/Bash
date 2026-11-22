"use client";

import { useState } from "react";
import { Box, Segmented, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

const WHO = ["user", "group", "other"] as const;
const PERM = [
  { bit: 4, ch: "r", file: "read the contents", dir: "list the names inside (ls)" },
  { bit: 2, ch: "w", file: "modify the contents", dir: "create, delete and rename entries (with x)" },
  { bit: 1, ch: "x", file: "execute it as a program", dir: "enter it (cd) and access entries by name" },
];

export default function PermissionsViz() {
  const [mode, setMode] = useState(0o754);
  const [kind, setKind] = useState<"file" | "dir">("file");
  const [octalInput, setOctalInput] = useState("754");
  const digits = [(mode >> 6) & 7, (mode >> 3) & 7, mode & 7];
  const special = (mode >> 9) & 7;
  const toggle = (who: number, bit: number) => {
    const shift = (2 - who) * 3;
    const next = mode ^ (bit << shift);
    setMode(next);
    setOctalInput((next & 0o7777).toString(8).padStart(3, "0"));
  };
  const sym = digits
    .map((d, i) => {
      let s = (d & 4 ? "r" : "-") + (d & 2 ? "w" : "-");
      const x = d & 1;
      if (i === 0 && special & 4) s += x ? "s" : "S";
      else if (i === 1 && special & 2) s += x ? "s" : "S";
      else if (i === 2 && special & 1) s += x ? "t" : "T";
      else s += x ? "x" : "-";
      return s;
    })
    .join("");
  const symbolic = WHO.map((w, i) => `${w[0]}=${["r", "w", "x"].filter((_, j) => digits[i] & (4 >> j)).join("")}`).join(",");

  return (
    <VizFrame title="File permission calculator" footer="Each digit of an octal mode is the sum r=4 + w=2 + x=1 for user, group and others. A leading fourth digit sets setuid (4), setgid (2) and sticky (1).">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented label="Type" value={kind} onChange={setKind} options={[{ value: "file", label: "file" }, { value: "dir", label: "directory" }]} />
        <label className="flex items-center gap-2 text-[12px] text-fg-subtle">
          octal
          <input
            value={octalInput}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-7]/g, "").slice(0, 4);
              setOctalInput(v);
              if (v.length >= 3) setMode(parseInt(v, 8));
            }}
            className="w-16 rounded-md border border-line bg-inset px-2 py-1 font-mono text-[14px] text-fg focus:border-accent/50 focus:outline-none"
            aria-label="Octal mode"
          />
        </label>
        {[0o644, 0o755, 0o600, 0o700, 0o775, 0o1777, 0o4755].map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setOctalInput(m.toString(8)); }} className="rounded border border-line px-1.5 py-0.5 font-mono text-[11.5px] text-fg-subtle hover:text-fg">
            {m.toString(8)}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <table className="border-collapse font-mono text-[12.5px]">
          <thead>
            <tr>
              <th />
              {PERM.map((p) => (
                <th key={p.ch} className="px-3 pb-1.5 text-[11px] font-medium text-fg-subtle">
                  {p.ch} ({p.bit})
                </th>
              ))}
              <th className="px-3 pb-1.5 text-[11px] font-medium text-fg-subtle">digit</th>
            </tr>
          </thead>
          <tbody>
            {WHO.map((w, i) => (
              <tr key={w}>
                <td className="pr-3 text-fg-muted">{w}</td>
                {PERM.map((p) => {
                  const on = (digits[i] & p.bit) !== 0;
                  return (
                    <td key={p.ch} className="px-3 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => toggle(i, p.bit)}
                        aria-pressed={on}
                        aria-label={`${w} ${p.ch}`}
                        className={cn("h-7 w-7 rounded border font-mono transition-colors", on ? "border-accent/60 bg-accent-dim text-accent" : "border-line bg-surface-2 text-fg-subtle hover:border-line-strong")}
                      >
                        {on ? p.ch : "-"}
                      </button>
                    </td>
                  );
                })}
                <td className="px-3 text-center text-[15px] text-fg">{digits[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-2">
          <Box title="ls -l shows">
            <code className="font-mono text-[14px] text-fg">
              {kind === "dir" ? "d" : "-"}
              {sym}
            </code>
            <span className="ml-3 font-mono text-[12px] text-fg-subtle">1 learner learner 4096 {kind === "dir" ? "projects/" : "deploy.sh"}</span>
          </Box>
          <Box title="commands that set this">
            <code className="block font-mono text-[12.5px] text-accent">chmod {(mode & 0o7777).toString(8).padStart(3, "0")} {kind === "dir" ? "projects" : "deploy.sh"}</code>
            <code className="block font-mono text-[12.5px] text-accent">chmod {symbolic} {kind === "dir" ? "projects" : "deploy.sh"}</code>
          </Box>
          <Box title={`what each class can do with this ${kind === "dir" ? "directory" : "file"}`}>
            <ul className="space-y-1 text-[12.5px] text-fg-muted">
              {WHO.map((w, i) => {
                const can = PERM.filter((p) => digits[i] & p.bit).map((p) => (kind === "dir" ? p.dir : p.file));
                return (
                  <li key={w}>
                    <b className="text-fg">{w}</b>: {can.length ? can.join("; ") : "nothing"}
                  </li>
                );
              })}
            </ul>
          </Box>
        </div>
      </div>
    </VizFrame>
  );
}
