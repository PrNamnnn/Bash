"use client";

import { useState } from "react";
import { Box, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

interface V {
  name: string;
  value: string;
  exported: boolean;
}

export default function ProcessTreeViz() {
  const [vars, setVars] = useState<V[]>([
    { name: "PATH", value: "/usr/local/bin:/usr/bin:/bin", exported: true },
    { name: "HOME", value: "/home/learner", exported: true },
    { name: "API_URL", value: "https://api.example.com", exported: false },
    { name: "count", value: "3", exported: false },
  ]);
  const [launched, setLaunched] = useState(false);
  const [childChanged, setChildChanged] = useState(false);
  const toggle = (i: number) => {
    setVars((v) => v.map((x, j) => (j === i ? { ...x, exported: !x.exported } : x)));
    setLaunched(false);
    setChildChanged(false);
  };
  const childVars = vars.filter((v) => v.exported).map((v) => (childChanged && v.name === "HOME" ? { ...v, value: "/tmp/elsewhere" } : v));

  return (
    <VizFrame
      title="Parent and child processes"
      footer="A child process receives a copy of the parent's exported variables (the environment), open file descriptors and working directory. Nothing it changes can flow back to the parent — the only channels back are its exit status, its output, and files."
    >
      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr]">
        <Box title="parent: bash (pid 3000)">
          <ul className="space-y-1.5">
            {vars.map((v, i) => (
              <li key={v.name} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className={cn("rounded border px-1.5 py-0.5 font-mono text-[10.5px]", v.exported ? "border-accent/50 bg-accent-dim/40 text-accent" : "border-line text-fg-subtle hover:text-fg-muted")}
                  aria-pressed={v.exported}
                  title="Toggle export"
                >
                  {v.exported ? "export" : "local"}
                </button>
                <code className="truncate font-mono text-[12px] text-fg-muted">
                  {v.name}=<span className="text-fg">{v.value}</span>
                </code>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setLaunched(true)} className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-fg hover:bg-accent-strong">
              Run ./child.sh
            </button>
            {launched && (
              <button type="button" onClick={() => setChildChanged(true)} className="rounded-md border border-line px-2.5 py-1 text-[12px] text-fg-muted hover:text-fg">
                child runs: export HOME=/tmp/elsewhere
              </button>
            )}
          </div>
        </Box>
        <div className="flex items-center justify-center font-mono text-[12px] text-fg-subtle md:flex-col" aria-hidden>
          <span>{launched ? "fork + exec ▶" : "…"}</span>
        </div>
        <Box title={launched ? "child: bash ./child.sh (pid 4231)" : "child (not started)"} tone={launched ? "accent" : "default"}>
          {launched ? (
            <ul className="space-y-1.5">
              {childVars.map((v) => (
                <li key={v.name}>
                  <code className={cn("font-mono text-[12px]", childChanged && v.name === "HOME" ? "text-amber" : "text-fg-muted")}>
                    {v.name}=<span className="text-fg">{v.value}</span>
                  </code>
                </li>
              ))}
              {vars
                .filter((v) => !v.exported)
                .map((v) => (
                  <li key={v.name} className="font-mono text-[12px] text-fg-subtle line-through">
                    {v.name} (not exported — invisible)
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-fg-subtle">Toggle which variables are exported, then start the child.</p>
          )}
        </Box>
      </div>
      {childChanged && (
        <p className="mt-3 rounded-md bg-amber-dim/40 px-3 py-2 text-[13px] text-fg-muted">
          The child changed its <b>own copy</b> of HOME. The parent still has <code className="inline-code">HOME=/home/learner</code>. This is why a script cannot <code className="inline-code">cd</code> or
          set variables for the shell that ran it — unless you <code className="inline-code">source</code> it instead.
        </p>
      )}
    </VizFrame>
  );
}
