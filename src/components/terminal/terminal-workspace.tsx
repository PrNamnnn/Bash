"use client";

import { useState } from "react";
import { CircleCheck, Info } from "lucide-react";
import { LazyTerminal } from "./lazy-terminal";
import { cn } from "@/lib/cn";

const MISSIONS = [
  { title: "Get your bearings", steps: ["pwd", "ls", "ls -la", "tree -L 2"] },
  { title: "Read a log", steps: ["head -n 5 logs/access.log", "wc -l logs/access.log", "grep ' 404 ' logs/access.log"] },
  { title: "Who hit the site most?", steps: ["awk '{print $1}' logs/access.log | sort | uniq -c | sort -rn | head -3"] },
  { title: "Errors by module", steps: ["grep ERROR logs/app.log", "grep -o '\\[[a-z]*\\]' logs/app.log | sort | uniq -c"] },
  { title: "Work with CSV", steps: ["column -t -s, data/sales.csv", "awk -F, 'NR>1 {u[$2]+=$4} END {for (r in u) print r, u[r]}' data/sales.csv"] },
  { title: "Make & run a script", steps: ["cd projects/scripts", "cat greet.sh", "./greet.sh Ada Linus", "./deploy.sh", "chmod +x deploy.sh && ./deploy.sh v1.2"] },
  { title: "Files and permissions", steps: ["mkdir -p sandbox/{src,docs}", "touch sandbox/src/app.sh", "chmod 755 sandbox/src/app.sh", "ls -l sandbox/src", "cat /etc/shadow"] },
  { title: "Explore the shell", steps: ["type cd ls ll if", "echo $PATH", "declare -p HOME", "help"] },
];

export function TerminalWorkspace() {
  const [mission, setMission] = useState(0);
  const m = MISSIONS[mission];
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-6 sm:px-6 lg:h-[calc(100dvh-var(--header-h))] lg:flex-row">
      <div className="min-h-[60vh] flex-1 lg:min-h-0">
        <LazyTerminal key={mission} height="100%" className="h-[60vh] lg:h-full" suggestions={m.steps} autoFocus title="learner@bash-mastery — sandbox" />
      </div>
      <aside className="w-full shrink-0 space-y-4 overflow-y-auto lg:w-[320px]">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h1 className="text-[16px] font-semibold text-fg">Terminal playground</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            A sandboxed Bash 5.2 interpreter with a realistic home directory: logs, CSV data, scripts, hidden files and permission-protected paths. Break things freely —{" "}
            <code className="inline-code">reset</code> restores everything.
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-[12px] text-amber">
            <Info size={13} className="mt-0.5 shrink-0" /> Simulated: runs in your browser, not on your machine. Networking, packages and services are not available.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-2 text-[13px] font-semibold text-fg">Missions</h2>
          <ul className="space-y-1">
            {MISSIONS.map((x, i) => (
              <li key={x.title}>
                <button
                  type="button"
                  onClick={() => setMission(i)}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors", i === mission ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2")}
                >
                  <CircleCheck size={13} className={i === mission ? "text-accent" : "text-line-strong"} />
                  {x.title}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-fg-subtle">Selecting a mission opens a fresh sandbox with its commands as clickable suggestions below the terminal.</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 text-[12.5px] text-fg-muted">
          <h2 className="mb-2 text-[13px] font-semibold text-fg">Shortcuts</h2>
          <ul className="space-y-1">
            <li><kbd className="font-mono text-fg">↑ / ↓</kbd> history</li>
            <li><kbd className="font-mono text-fg">Tab</kbd> complete commands and paths</li>
            <li><kbd className="font-mono text-fg">Ctrl+L</kbd> clear · <kbd className="font-mono text-fg">Ctrl+C</kbd> cancel line · <kbd className="font-mono text-fg">Ctrl+U</kbd> erase line</li>
            <li><code className="font-mono text-fg">!!</code> repeat last command · <code className="font-mono text-fg">help</code> list supported commands · <code className="font-mono text-fg">man ls</code> condensed manual</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
