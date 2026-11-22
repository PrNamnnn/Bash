"use client";

import { useMemo, useState } from "react";
import { runScript } from "@/lib/shell";
import { Box, Segmented, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

const CASES = {
  current: {
    label: "current shell",
    code: "count=0\n{ count=5; cd /tmp; }\necho \"count=$count pwd=$PWD\"",
    explain: "A { } group runs in the current shell. Changes to variables and the working directory persist.",
  },
  subshell: {
    label: "( subshell )",
    code: "count=0\n( count=5; cd /tmp )\necho \"count=$count pwd=$PWD\"",
    explain: "( ) forks a copy of the shell. The copy changes its own variables and directory, then exits — the parent is untouched.",
  },
  pipeline: {
    label: "pipeline",
    code: "count=0\nprintf 'a\\nb\\nc\\n' | while read -r line; do\n  count=$((count+1))\ndone\necho \"count=$count\"",
    explain: "Each part of a pipeline runs in its own subshell. The while loop counts to 3 — in a child that is thrown away. This is the classic \"my variable is empty after the loop\" bug.",
  },
  fix: {
    label: "fix: redirect",
    code: "count=0\nwhile read -r line; do\n  count=$((count+1))\ndone < <(printf 'a\\nb\\nc\\n')\necho \"count=$count\"",
    explain: "Feeding the loop with a redirection (here, process substitution) keeps the loop in the current shell, so count survives.",
  },
  substitution: {
    label: "$( )",
    code: "x=outer\ny=$(x=inner; echo \"$x\")\necho \"x=$x y=$y\"",
    explain: "Command substitution also runs in a subshell. Only its output comes back; the assignment to x inside does not.",
  },
} as const;

type Key = keyof typeof CASES;

export default function SubshellViz() {
  const [key, setKey] = useState<Key>("pipeline");
  const c = CASES[key];
  const result = useMemo(() => {
    const r = runScript({ code: c.code + '\necho "BASHPID=$BASHPID  \\$\\$=$$"', fixture: "default" });
    return r.stdout.trim().split("\n");
  }, [c.code]);
  const isSub = key !== "current" && key !== "fix";
  return (
    <VizFrame title="Process vs subshell" footer="$$ is always the PID of the main shell — even inside a subshell. $BASHPID is the PID of the process actually running the code.">
      <div className="mb-4">
        <Segmented label="Scenario" value={key} onChange={setKey} options={(Object.keys(CASES) as Key[]).map((k) => ({ value: k, label: CASES[k].label }))} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <pre className="rounded-md border border-line bg-inset px-3 py-2 font-mono text-[12.5px] leading-[1.6] text-fg">{c.code}</pre>
        <div className="space-y-3">
          <div className="flex items-stretch gap-2">
            <Box title="parent shell" className="flex-1">
              <div className="font-mono text-[12px] text-fg-muted">pid 3000</div>
              <div className="mt-1 text-[12px] text-fg-muted">keeps its own variables and cwd</div>
            </Box>
            <div className={cn("flex items-center font-mono text-[12px]", isSub ? "text-violet" : "text-fg-subtle")}>{isSub ? "fork ▶" : "·"}</div>
            <Box title={isSub ? "subshell (copy)" : "no child process"} tone={isSub ? "violet" : "default"} className="flex-1">
              <div className="font-mono text-[12px] text-fg-muted">{isSub ? "pid 42xx" : "—"}</div>
              <div className="mt-1 text-[12px] text-fg-muted">{isSub ? "changes vanish when it exits" : "code runs in the parent"}</div>
            </Box>
          </div>
          <Box title="real output (simulated Bash)">
            <pre className="font-mono text-[12.5px] whitespace-pre-wrap text-accent">{result.join("\n")}</pre>
          </Box>
        </div>
      </div>
      <p className="mt-3 text-[13.5px] text-fg-muted">{c.explain}</p>
    </VizFrame>
  );
}
