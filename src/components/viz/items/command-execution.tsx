"use client";

import { useState } from "react";
import { Box, Mono, Segmented, StepControls, useStepper, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

interface Stage {
  name: string;
  what: string;
  view: React.ReactNode;
}

const Chip = ({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "op" | "word" | "redir" | "new" }) => (
  <span
    className={cn(
      "rounded border px-1.5 py-0.5 font-mono text-[12px]",
      tone === "op" && "border-violet/40 bg-violet-dim/40 text-violet",
      tone === "word" && "border-line-strong bg-surface-3 text-fg",
      tone === "redir" && "border-amber/40 bg-amber-dim/40 text-amber",
      tone === "new" && "border-accent/50 bg-accent-dim/40 text-accent",
      tone === "plain" && "border-line bg-surface-2 text-fg-muted",
    )}
  >
    {children}
  </span>
);

const EXAMPLES = {
  ls: {
    line: 'ls -l "$HOME/projects" > listing.txt',
    tokens: [["ls", "word"], ["-l", "word"], ['"$HOME/projects"', "word"], [">", "redir"], ["listing.txt", "word"]] as const,
    expanded: ["ls", "-l", "/home/learner/projects"],
    redir: "fd 1 → listing.txt (created/truncated)",
    lookup: ["alias? no", "keyword? no", "function? no", "builtin? no", "PATH: /usr/local/bin/ls ✗", "PATH: /usr/bin/ls ✓"],
    program: "/usr/bin/ls",
    status: 0,
    result: "listing.txt now contains the long listing; nothing appears on screen.",
  },
  grep: {
    line: "grep -c ERROR logs/app.log",
    tokens: [["grep", "word"], ["-c", "word"], ["ERROR", "word"], ["logs/app.log", "word"]] as const,
    expanded: ["grep", "-c", "ERROR", "logs/app.log"],
    redir: "none — fd 0/1/2 stay connected to the terminal",
    lookup: ["alias? no", "keyword? no", "function? no", "builtin? no", "PATH: /usr/local/bin/grep ✗", "PATH: /usr/bin/grep ✓"],
    program: "/usr/bin/grep",
    status: 0,
    result: "prints 3 on the terminal",
  },
  cd: {
    line: "cd ~/logs && pwd",
    tokens: [["cd", "word"], ["~/logs", "word"], ["&&", "op"], ["pwd", "word"]] as const,
    expanded: ["cd", "/home/learner/logs"],
    redir: "none",
    lookup: ["alias? no", "keyword? no", "function? no", "builtin? YES — cd is a shell builtin"],
    program: "builtin cd (no fork: it must change the shell's own directory)",
    status: 0,
    result: "the shell's working directory changes; then pwd runs because cd succeeded",
  },
} as const;

type Key = keyof typeof EXAMPLES;

export default function CommandExecutionViz() {
  const [key, setKey] = useState<Key>("ls");
  const ex = EXAMPLES[key];
  const isBuiltin = key === "cd";
  const stages: Stage[] = [
    {
      name: "1. Read",
      what: "Bash reads a complete line from the terminal (or the next line of a script). Nothing has been interpreted yet — it is just characters.",
      view: <Mono className="text-fg">{ex.line}</Mono>,
    },
    {
      name: "2. Tokenise & parse",
      what: "The line is split into words and operators. Quotes are remembered but not removed yet. Operators like `>`, `|`, `&&` are recognised here, which is why quoting them makes them ordinary text.",
      view: (
        <div className="flex flex-wrap gap-1.5">
          {ex.tokens.map(([t, tone], i) => (
            <Chip key={i} tone={tone}>
              {t}
            </Chip>
          ))}
        </div>
      ),
    },
    {
      name: "3. Expand",
      what: "Each word goes through expansion: tilde, parameters ($HOME), command substitution, arithmetic, word splitting, globbing and finally quote removal. The command never sees $HOME or ~ — it sees the result.",
      view: (
        <div className="flex flex-wrap items-center gap-1.5">
          {ex.expanded.map((w, i) => (
            <Chip key={i} tone="new">
              {w}
            </Chip>
          ))}
          <span className="text-[12px] text-fg-subtle">→ argv has {ex.expanded.length} elements</span>
        </div>
      ),
    },
    {
      name: "4. Redirections",
      what: "Redirections are set up for this command only (left to right). The command itself never sees `>` or the file name.",
      view: <Mono className="text-amber">{ex.redir}</Mono>,
    },
    {
      name: "5. Lookup",
      what: "Bash decides what the first word means, in a fixed order. The first match wins.",
      view: (
        <ol className="space-y-0.5 font-mono text-[12px]">
          {ex.lookup.map((l, i) => (
            <li key={i} className={cn(i === ex.lookup.length - 1 ? "text-accent" : "text-fg-subtle")}>
              {l}
            </li>
          ))}
        </ol>
      ),
    },
    {
      name: isBuiltin ? "6. Run builtin" : "6. fork()",
      what: isBuiltin
        ? "Builtins run inside the shell process itself — no new process. That is the only way `cd` can change the shell's directory."
        : "Bash clones itself with fork(). The child is an exact copy: same open files (with the redirection applied), same exported environment.",
      view: (
        <div className="flex items-center gap-3 font-mono text-[12px]">
          <Box title="parent" className="min-w-28">
            bash <span className="text-fg-subtle">pid 3000</span>
          </Box>
          {!isBuiltin && (
            <>
              <span className="text-fg-subtle">──fork──▶</span>
              <Box title="child" tone="accent" className="min-w-28">
                bash <span className="text-fg-subtle">pid 4217</span>
              </Box>
            </>
          )}
        </div>
      ),
    },
    {
      name: isBuiltin ? "7. Side effects" : "7. exec()",
      what: isBuiltin
        ? "The builtin updates the shell's state directly ($PWD, $OLDPWD)."
        : "The child replaces its program image with the external program via execve(). The PID stays the same; the code is now the program's.",
      view: (
        <Box title={isBuiltin ? "shell state" : "child pid 4217"} tone="accent">
          <Mono>{ex.program}</Mono>
          {!isBuiltin && <span className="ml-2 font-mono text-[12px] text-fg-subtle">argv = [{ex.expanded.map((w) => `"${w}"`).join(", ")}]</span>}
        </Box>
      ),
    },
    {
      name: "8. Wait & status",
      what: "Bash waits for the child to exit and stores its exit status in $?. 0 means success; anything else is failure. Then it prints the next prompt.",
      view: (
        <div className="space-y-1 text-[13px] text-fg-muted">
          <div>
            <Mono className="text-accent">$? = {ex.status}</Mono>
          </div>
          <div>{ex.result}</div>
        </div>
      ),
    },
  ];
  const s = useStepper(stages.length, [key]);
  const st = stages[s.step];
  return (
    <VizFrame title="How the shell executes a command">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Example command" value={key} onChange={setKey} options={(Object.keys(EXAMPLES) as Key[]).map((k) => ({ value: k, label: EXAMPLES[k].line.split(" ")[0] }))} />
        <StepControls {...s} count={stages.length} />
      </div>
      <div className="mb-3 rounded-md border border-line bg-inset px-3 py-2 font-mono text-[13px]">
        <span className="text-accent">$ </span>
        {ex.line}
      </div>
      <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto">
        {stages.map((x, i) => (
          <button
            key={x.name}
            type="button"
            onClick={() => s.setStep(i)}
            className={cn("shrink-0 rounded px-2 py-1 text-[11.5px] transition-colors", i === s.step ? "bg-accent text-accent-fg" : i < s.step ? "bg-accent-dim/60 text-accent" : "bg-surface-2 text-fg-subtle hover:text-fg-muted")}
          >
            {x.name}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
        <p className="text-[13.5px] leading-relaxed text-fg-muted">{st.what}</p>
        <Box title={st.name}>{st.view}</Box>
      </div>
    </VizFrame>
  );
}
