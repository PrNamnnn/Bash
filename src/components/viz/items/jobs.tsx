"use client";

import { useEffect, useRef, useState } from "react";
import { VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

type State = "Running" | "Stopped" | "Done" | "Terminated";
interface Job {
  id: number;
  pid: number;
  cmd: string;
  state: State;
  remaining: number;
  fg: boolean;
}

const COMMANDS = ["sleep 20", "tar czf backup.tgz ~/projects", "./long-report.sh", "find / -name '*.log'"];

export default function JobsViz() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [log, setLog] = useState<string[]>(["$ # start a job in the background with &, or in the foreground"]);
  const nextId = useRef(1);
  const nextPid = useRef(5120);

  // tick running jobs
  useEffect(() => {
    const t = setInterval(() => {
      setJobs((js) => {
        let changed = false;
        const next = js.map((j) => {
          if (j.state !== "Running") return j;
          changed = true;
          const remaining = j.remaining - 1;
          if (remaining <= 0) return { ...j, remaining: 0, state: "Done" as State, fg: false };
          return { ...j, remaining };
        });
        return changed ? next : js;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const fgJob = jobs.find((j) => j.fg && j.state === "Running");
  const say = (...lines: string[]) => setLog((l) => [...l, ...lines].slice(-14));

  const start = (cmd: string, bg: boolean) => {
    if (fgJob) return;
    const job: Job = { id: nextId.current++, pid: nextPid.current++, cmd, state: "Running", remaining: 12 + ((nextPid.current * 7) % 10), fg: !bg };
    setJobs((j) => [...j.filter((x) => x.state === "Running" || x.state === "Stopped"), job]);
    say(`$ ${cmd}${bg ? " &" : ""}`, ...(bg ? [`[${job.id}] ${job.pid}`] : ["(running in the foreground — the prompt is blocked)"]));
  };
  const update = (id: number, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  const ctrlZ = () => {
    if (!fgJob) return;
    update(fgJob.id, { state: "Stopped", fg: false });
    say("^Z", `[${fgJob.id}]+  Stopped                 ${fgJob.cmd}`);
  };
  const ctrlC = () => {
    if (!fgJob) return;
    update(fgJob.id, { state: "Terminated", fg: false });
    say("^C", "(SIGINT sent to the foreground job; exit status 130)");
  };
  const list = () => {
    const active = jobs.filter((j) => j.state !== "Terminated");
    say("$ jobs", ...(active.length ? active.map((j, i) => `[${j.id}]${i === active.length - 1 ? "+" : "-"}  ${j.state.padEnd(22)}${j.cmd}${j.state === "Running" && !j.fg ? " &" : ""}`) : ["(no jobs)"]));
    setJobs((js) => js.filter((j) => j.state !== "Done"));
  };
  const lastStopped = [...jobs].reverse().find((j) => j.state === "Stopped");
  const bg = () => {
    if (!lastStopped) return say("$ bg", "bash: bg: current: no such job");
    update(lastStopped.id, { state: "Running", fg: false });
    say("$ bg", `[${lastStopped.id}]+ ${lastStopped.cmd} &`);
  };
  const fg = () => {
    const target = lastStopped ?? [...jobs].reverse().find((j) => j.state === "Running" && !j.fg);
    if (!target) return say("$ fg", "bash: fg: current: no such job");
    update(target.id, { state: "Running", fg: true });
    say("$ fg", target.cmd);
  };
  const kill = (j: Job) => {
    update(j.id, { state: "Terminated", fg: false });
    say(`$ kill %${j.id}`, `[${j.id}]+  Terminated              ${j.cmd}`);
  };

  const btn = "rounded-md border border-line px-2.5 py-1 font-mono text-[12px] text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-30";

  return (
    <VizFrame title="Background jobs and job control" footer="Job control is a feature of interactive shells: & starts a job without waiting, Ctrl+Z stops the foreground job (SIGTSTP), bg resumes it in the background (SIGCONT), fg brings it back. Scripts normally use & together with wait.">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {COMMANDS.map((c) => (
          <span key={c} className="flex overflow-hidden rounded-md border border-line">
            <button type="button" className="px-2 py-1 font-mono text-[11.5px] text-fg-muted hover:bg-surface-3 disabled:opacity-30" disabled={!!fgJob} onClick={() => start(c, false)}>
              {c}
            </button>
            <button type="button" className="border-l border-line px-2 py-1 font-mono text-[11.5px] text-accent hover:bg-surface-3 disabled:opacity-30" disabled={!!fgJob} onClick={() => start(c, true)} aria-label={`${c} in background`}>
              &amp;
            </button>
          </span>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button type="button" className={btn} onClick={ctrlZ} disabled={!fgJob}>
          Ctrl+Z
        </button>
        <button type="button" className={btn} onClick={ctrlC} disabled={!fgJob}>
          Ctrl+C
        </button>
        <button type="button" className={btn} onClick={list} disabled={!!fgJob}>
          jobs
        </button>
        <button type="button" className={btn} onClick={bg} disabled={!!fgJob}>
          bg
        </button>
        <button type="button" className={btn} onClick={fg} disabled={!!fgJob}>
          fg
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <pre className="h-56 overflow-auto rounded-md border border-line bg-inset px-3 py-2 font-mono text-[12px] leading-[1.6] text-fg-muted" aria-live="polite">
          {log.join("\n")}
          {!fgJob && <span className="block text-accent">$ ▍</span>}
        </pre>
        <ul className="space-y-1.5">
          {jobs.filter((j) => j.state !== "Terminated").length === 0 && <li className="text-[12.5px] text-fg-subtle">No jobs yet.</li>}
          {jobs
            .filter((j) => j.state !== "Terminated")
            .map((j) => (
              <li key={j.id} className={cn("rounded-md border px-3 py-2", j.fg ? "border-accent/50 bg-accent-dim/30" : "border-line bg-surface-2")}>
                <div className="flex items-center gap-2 font-mono text-[12px]">
                  <span className="text-fg-subtle">%{j.id}</span>
                  <span className="truncate text-fg">{j.cmd}</span>
                  <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[10.5px]", j.state === "Running" ? "bg-accent-dim text-accent" : j.state === "Stopped" ? "bg-amber-dim text-amber" : "bg-surface-3 text-fg-subtle")}>
                    {j.state}
                    {j.fg ? " · fg" : j.state === "Running" ? " · bg" : ""}
                  </span>
                  {j.state !== "Done" && !j.fg && (
                    <button type="button" onClick={() => kill(j)} className="rounded px-1 text-[11px] text-red hover:bg-red-dim/50">
                      kill
                    </button>
                  )}
                </div>
                {j.state === "Running" && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${100 - (j.remaining / 22) * 100}%` }} />
                  </div>
                )}
              </li>
            ))}
        </ul>
      </div>
    </VizFrame>
  );
}
