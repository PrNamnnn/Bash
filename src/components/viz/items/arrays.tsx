"use client";

import { useMemo, useState } from "react";
import { runScript } from "@/lib/shell";
import { Box, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

const INITIAL = ["web01", "web02", "db 01"];

export default function ArraysViz() {
  const [ops, setOps] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("cache01");
  const [unsetIdx, setUnsetIdx] = useState("1");
  const script = `servers=(${INITIAL.map((s) => `"${s}"`).join(" ")})\n${ops.join("\n")}`;
  const state = useMemo(() => {
    const r = runScript({
      code: `${script}\nprintf '%s\\0' "\${!servers[@]}"; printf '\\1'; printf '%s\\0' "\${servers[@]}"; printf '\\1'; printf '%s\\0' \${servers[@]}`,
      fixture: "default",
    });
    const [keys = "", vals = "", unq = ""] = r.stdout.split("\x01");
    const split = (s: string) => (s ? s.split("\0").slice(0, -1) : []);
    return { keys: split(keys), vals: split(vals), unquoted: split(unq), err: r.stderr };
  }, [script]);

  const add = (op: string) => setOps((o) => [...o, op]);
  const btn = "rounded-md border border-line px-2 py-1 font-mono text-[11.5px] text-fg-muted hover:border-line-strong hover:text-fg";

  return (
    <VizFrame title="Array operations" footer='Indexed arrays can be sparse: unset leaves a gap and indices are not renumbered. Always iterate with "${arr[@]}" (quoted) — unquoted, "db 01" splits into two words.'>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <input value={newItem} onChange={(e) => setNewItem(e.target.value)} className="w-28 rounded-md border border-line bg-inset px-2 py-1 font-mono text-[12px] text-fg focus:outline-none" aria-label="New element" />
        <button type="button" className={btn} onClick={() => add(`servers+=("${newItem.replace(/"/g, '\\"')}")`)}>
          servers+=(&quot;{newItem}&quot;)
        </button>
        <button type="button" className={btn} onClick={() => add(`servers[0]="${newItem.replace(/"/g, '\\"')}"`)}>
          servers[0]=…
        </button>
        <input value={unsetIdx} onChange={(e) => setUnsetIdx(e.target.value.replace(/[^0-9]/g, ""))} className="w-12 rounded-md border border-line bg-inset px-2 py-1 font-mono text-[12px] text-fg focus:outline-none" aria-label="Index to unset" />
        <button type="button" className={btn} onClick={() => add(`unset 'servers[${unsetIdx || 0}]'`)}>
          unset servers[{unsetIdx || 0}]
        </button>
        <button type="button" className={btn} onClick={() => add('servers=("${servers[@]}")')}>
          re-index
        </button>
        <button type="button" className={cn(btn, "ml-auto")} onClick={() => setOps([])}>
          reset
        </button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {state.keys.map((k, i) => (
          <div key={k} className="overflow-hidden rounded-md border border-line-strong">
            <div className="bg-surface-3 px-2 py-0.5 text-center font-mono text-[10.5px] text-fg-subtle">[{k}]</div>
            <div className="px-3 py-1.5 font-mono text-[12.5px] whitespace-pre text-fg">{state.vals[i]}</div>
          </div>
        ))}
        {!state.keys.length && <p className="text-[12.5px] text-fg-subtle">(empty array)</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Box title="expressions">
          <ul className="space-y-1 font-mono text-[12px]">
            <li>
              <span className="text-fg-subtle">{"${#servers[@]}"}</span> → <span className="text-accent">{state.vals.length}</span>
            </li>
            <li>
              <span className="text-fg-subtle">{"${!servers[@]}"}</span> → <span className="text-accent">{state.keys.join(" ")}</span>
            </li>
            <li>
              <span className="text-fg-subtle">{"${servers[@]: -1}"}</span> → <span className="text-accent">{state.vals[state.vals.length - 1] ?? ""}</span>
            </li>
            <li>
              <span className="text-fg-subtle">for s in &quot;{"${servers[@]}"}&quot;</span> → <span className="text-accent">{state.vals.length} iterations</span>
            </li>
            <li>
              <span className="text-fg-subtle">for s in {"${servers[@]}"}</span> → <span className={state.unquoted.length !== state.vals.length ? "text-red" : "text-accent"}>{state.unquoted.length} iterations</span>
            </li>
          </ul>
        </Box>
        <Box title="script so far">
          <pre className="max-h-40 overflow-auto font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-fg-muted">{script}</pre>
        </Box>
      </div>
    </VizFrame>
  );
}
