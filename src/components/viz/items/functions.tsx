"use client";

import { useMemo } from "react";
import { Box, StepControls, useStepper, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

interface Frame {
  name: string;
  args: string;
  locals: Record<string, string>;
}
interface Step {
  line: number;
  stack: Frame[];
  globals: Record<string, string>;
  out: string[];
  note: string;
}

const CODE = [
  "greeting=Hello",
  "shout() {",
  '  local msg="${1^^}"',
  '  echo "$msg!"',
  "}",
  "welcome() {",
  "  local name=$1",
  '  greeting="Welcome"',
  '  shout "$greeting, $name"',
  "  return 0",
  "}",
  "welcome ada",
  'echo "greeting is now: $greeting"',
];

export default function FunctionsViz() {
  const steps = useMemo<Step[]>(() => {
    const main: Frame = { name: "main", args: "", locals: {} };
    return [
      { line: 1, stack: [main], globals: { greeting: "Hello" }, out: [], note: "A global variable." },
      { line: 2, stack: [main], globals: { greeting: "Hello" }, out: [], note: "Defining shout and welcome only stores their bodies; nothing runs yet." },
      { line: 12, stack: [main, { name: "welcome", args: "ada", locals: {} }], globals: { greeting: "Hello" }, out: [], note: "Calling welcome pushes a new frame. Inside it, $1 is 'ada' — the function's own positional parameters." },
      { line: 7, stack: [main, { name: "welcome", args: "ada", locals: { name: "ada" } }], globals: { greeting: "Hello" }, out: [], note: "local creates name in welcome's frame only." },
      { line: 8, stack: [main, { name: "welcome", args: "ada", locals: { name: "ada" } }], globals: { greeting: "Welcome" }, out: [], note: "No local here! greeting is the global variable, so the caller's value is overwritten." },
      { line: 9, stack: [main, { name: "welcome", args: "ada", locals: { name: "ada" } }, { name: "shout", args: '"Welcome, ada"', locals: {} }], globals: { greeting: "Welcome" }, out: [], note: "welcome calls shout: another frame on top. shout's $1 is the single string 'Welcome, ada' because it was quoted." },
      { line: 3, stack: [main, { name: "welcome", args: "ada", locals: { name: "ada" } }, { name: "shout", args: '"Welcome, ada"', locals: { msg: "WELCOME, ADA" } }], globals: { greeting: "Welcome" }, out: [], note: "${1^^} upper-cases the argument into a local msg. (Bash uses dynamic scoping: shout could also read welcome's local name.)" },
      { line: 4, stack: [main, { name: "welcome", args: "ada", locals: { name: "ada" } }, { name: "shout", args: '"Welcome, ada"', locals: { msg: "WELCOME, ADA" } }], globals: { greeting: "Welcome" }, out: ["WELCOME, ADA!"], note: "Output goes to stdout. Functions 'return' data by printing it." },
      { line: 5, stack: [main, { name: "welcome", args: "ada", locals: { name: "ada" } }], globals: { greeting: "Welcome" }, out: ["WELCOME, ADA!"], note: "shout finishes: its frame (and msg) is popped. Its status is that of its last command (0)." },
      { line: 10, stack: [main, { name: "welcome", args: "ada", locals: { name: "ada" } }], globals: { greeting: "Welcome" }, out: ["WELCOME, ADA!"], note: "return sets the function's exit status (0–255). It is not for returning data." },
      { line: 13, stack: [main], globals: { greeting: "Welcome" }, out: ["WELCOME, ADA!", "greeting is now: Welcome"], note: "Back in main: name is gone, but the global greeting was changed by welcome — use local to avoid this." },
    ];
  }, []);
  const s = useStepper(steps.length);
  const st = steps[s.step];
  return (
    <VizFrame title="Function calls and the call stack">
      <div className="mb-4 flex justify-end">
        <StepControls {...s} count={steps.length} />
      </div>
      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <pre className="rounded-md border border-line bg-inset py-2 font-mono text-[12.5px] leading-[1.7]">
          {CODE.map((l, i) => (
            <div key={i} className={cn("flex gap-3 px-3", st.line === i + 1 && "bg-accent-dim/60")}>
              <span className="w-5 text-right text-fg-subtle select-none">{i + 1}</span>
              <span className={st.line === i + 1 ? "text-fg" : "text-fg-muted"}>{l}</span>
            </div>
          ))}
        </pre>
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">call stack (top = running)</div>
            <div className="flex flex-col-reverse gap-1.5">
              {st.stack.map((f, i) => (
                <div key={f.name + i} className={cn("rounded-md border px-3 py-2 font-mono text-[12px]", i === st.stack.length - 1 ? "border-accent/50 bg-accent-dim/30" : "border-line bg-surface-2")}>
                  <div className="text-fg">
                    {f.name} <span className="text-fg-subtle">{f.args && `$1=${f.args}`}</span>
                  </div>
                  {Object.keys(f.locals).length > 0 && (
                    <div className="mt-0.5 text-fg-muted">
                      local: {Object.entries(f.locals).map(([k, v]) => `${k}=${v}`).join("  ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <Box title="globals">
            <code className="font-mono text-[12.5px] text-fg">greeting={st.globals.greeting}</code>
          </Box>
          <Box title="output">
            <pre className="min-h-8 font-mono text-[12.5px] text-accent">{st.out.join("\n") || " "}</pre>
          </Box>
          <p className="text-[13px] text-fg-muted">{st.note}</p>
        </div>
      </div>
    </VizFrame>
  );
}
