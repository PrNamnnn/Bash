"use client";

import { useMemo, useState } from "react";
import { runScript } from "@/lib/shell";
import { VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

const SAMPLES = ["my file.txt", "  spaced   out  ", "*.csv", "$HOME", "a\"b", ""];

function shQuoteSingle(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export default function QuotingViz() {
  const [value, setValue] = useState("my file.txt");
  const rows = useMemo(() => {
    const setup = `cd data; v=${shQuoteSingle(value)}`;
    const forms = [
      { label: "unquoted", code: "$v", desc: "Split on whitespace, then each piece is globbed." },
      { label: "double quotes", code: '"$v"', desc: "Exactly one argument; $, ` and \\ still work inside." },
      { label: "single quotes", code: "'$v'", desc: "Completely literal: no expansion at all." },
      { label: "$'…' ANSI-C", code: "$'tab:\\there'", desc: "Backslash escapes like \\t and \\n are interpreted." },
    ];
    return forms.map((f) => {
      const r = runScript({ code: `${setup}; printf '%s\\0' ${f.code}`, fixture: "default" });
      const args = r.stdout === "" ? [] : r.stdout.split("\0").slice(0, -1);
      return { ...f, args };
    });
  }, [value]);

  return (
    <VizFrame title="Quoting side by side" footer="Rule of thumb: always double-quote variable expansions (&quot;$var&quot;, &quot;$@&quot;) unless you specifically want word splitting and globbing.">
      <div className="mb-4 space-y-2">
        <label className="block text-[12px] text-fg-subtle">
          Value of <code className="font-mono text-fg-muted">v</code>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            className="mt-1 block w-full rounded-md border border-line bg-inset px-3 py-2 font-mono text-[14px] text-fg whitespace-pre focus:border-accent/50 focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button key={s || "empty"} type="button" onClick={() => setValue(s)} className={cn("rounded border px-2 py-0.5 font-mono text-[11.5px]", value === s ? "border-accent/50 text-fg" : "border-line text-fg-subtle hover:text-fg-muted")}>
              {s === "" ? "(empty)" : JSON.stringify(s).slice(1, -1)}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="grid gap-2 rounded-md border border-line bg-surface-2 p-3 md:grid-cols-[11rem_1fr]">
            <div>
              <code className="font-mono text-[13px] text-fg">cmd {r.code}</code>
              <div className="text-[11.5px] text-fg-subtle">{r.label}</div>
            </div>
            <div>
              <div className="mb-1 text-[11.5px] text-fg-subtle">
                command receives <b className={cn(r.args.length === 1 ? "text-accent" : "text-amber")}>{r.args.length}</b> argument{r.args.length === 1 ? "" : "s"}
                <span className="ml-2">{r.desc}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.args.length === 0 && <span className="font-mono text-[12px] text-fg-subtle italic">nothing — the word vanished</span>}
                {r.args.map((a, i) => (
                  <span key={i} className="rounded border border-line-strong bg-inset px-1.5 py-0.5 font-mono text-[12px] whitespace-pre text-fg">
                    {a === "" ? "''" : a.replace(/\t/g, "→")}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}
