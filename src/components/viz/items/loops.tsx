"use client";

import { useMemo, useState } from "react";
import { Box, Segmented, StepControls, useStepper, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

interface Frame {
  line: number;
  vars: Record<string, string>;
  out: string[];
  note: string;
}

const PROGRAMS = {
  for: {
    code: ["for file in report.txt notes.md todo.txt; do", '  [[ $file == *.txt ]] || continue', '  echo "processing $file"', "done", 'echo "finished"'],
    frames(): Frame[] {
      const f: Frame[] = [];
      const out: string[] = [];
      const items = ["report.txt", "notes.md", "todo.txt"];
      items.forEach((it) => {
        f.push({ line: 1, vars: { file: it }, out: [...out], note: `The next word from the list is assigned to file.` });
        const ok = it.endsWith(".txt");
        f.push({ line: 2, vars: { file: it }, out: [...out], note: ok ? `${it} matches *.txt, so the test succeeds and continue is skipped.` : `${it} doesn't match *.txt → continue jumps straight to the next iteration.` });
        if (ok) {
          out.push(`processing ${it}`);
          f.push({ line: 3, vars: { file: it }, out: [...out], note: "The body runs with the current value." });
        }
        f.push({ line: 4, vars: { file: it }, out: [...out], note: it === items[items.length - 1] ? "The list is exhausted: the loop ends." : "done: go back to the top for the next word." });
      });
      out.push("finished");
      f.push({ line: 5, vars: { file: "todo.txt" }, out: [...out], note: "After the loop, file keeps its last value." });
      return f;
    },
  },
  while: {
    code: ["n=3", "while (( n > 0 )); do", '  echo "T-minus $n"', "  (( n-- ))", "done", 'echo "liftoff (n=$n)"'],
    frames(): Frame[] {
      const f: Frame[] = [];
      const out: string[] = [];
      let n = 3;
      f.push({ line: 1, vars: { n: "3" }, out: [], note: "Initialise the counter." });
      for (;;) {
        const cond = n > 0;
        f.push({ line: 2, vars: { n: String(n) }, out: [...out], note: `(( n > 0 )) is ${cond ? "true (exit status 0)" : "false (exit status 1)"}${cond ? " → run the body" : " → leave the loop"}.` });
        if (!cond) break;
        out.push(`T-minus ${n}`);
        f.push({ line: 3, vars: { n: String(n) }, out: [...out], note: "Print the current value." });
        n--;
        f.push({ line: 4, vars: { n: String(n) }, out: [...out], note: "Decrement. Forgetting this line creates an infinite loop." });
        f.push({ line: 5, vars: { n: String(n) }, out: [...out], note: "done: re-test the condition." });
      }
      out.push(`liftoff (n=${n})`);
      f.push({ line: 6, vars: { n: String(n) }, out: [...out], note: "The loop has ended." });
      return f;
    },
  },
  cstyle: {
    code: ["total=0", "for (( i = 1; i <= 4; i++ )); do", "  (( total += i ))", "done", 'echo "sum=$total"'],
    frames(): Frame[] {
      const f: Frame[] = [];
      let total = 0;
      f.push({ line: 1, vars: { total: "0" }, out: [], note: "Initialise the accumulator." });
      for (let i = 1; ; i++) {
        f.push({ line: 2, vars: { i: String(i), total: String(total) }, out: [], note: i === 1 ? "init i=1, then test i <= 4 → true." : `i++ made i=${i}; test i <= 4 → ${i <= 4}.` });
        if (i > 4) break;
        total += i;
        f.push({ line: 3, vars: { i: String(i), total: String(total) }, out: [], note: `total += ${i}` });
        f.push({ line: 4, vars: { i: String(i), total: String(total) }, out: [], note: "End of body; the update expression i++ runs next." });
      }
      f.push({ line: 5, vars: { i: "5", total: String(total) }, out: [`sum=${total}`], note: "Print the result." });
      return f;
    },
  },
} as const;

type Key = keyof typeof PROGRAMS;

export default function LoopsViz() {
  const [key, setKey] = useState<Key>("for");
  const prog = PROGRAMS[key];
  const frames = useMemo(() => prog.frames(), [prog]);
  const s = useStepper(frames.length, [key]);
  const fr = frames[s.step];
  return (
    <VizFrame title="Loop execution stepper">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Loop type" value={key} onChange={setKey} options={[{ value: "for", label: "for … in" }, { value: "while", label: "while" }, { value: "cstyle", label: "for (( ))" }]} />
        <StepControls {...s} count={frames.length} />
      </div>
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <pre className="rounded-md border border-line bg-inset py-2 font-mono text-[12.5px] leading-[1.75]">
          {prog.code.map((l, i) => (
            <div key={i} className={cn("flex gap-3 px-3", fr.line === i + 1 && "bg-accent-dim/60")}>
              <span className="w-4 text-right text-fg-subtle select-none">{i + 1}</span>
              <span className={fr.line === i + 1 ? "text-fg" : "text-fg-muted"}>{l}</span>
            </div>
          ))}
        </pre>
        <div className="space-y-3">
          <Box title="variables">
            <div className="flex flex-wrap gap-2 font-mono text-[12.5px]">
              {Object.entries(fr.vars).map(([k, v]) => (
                <span key={k} className="rounded border border-line-strong bg-inset px-2 py-0.5">
                  <span className="text-var tok-var">{k}</span>=<span className="text-fg">{v}</span>
                </span>
              ))}
            </div>
          </Box>
          <Box title="output">
            <pre className="min-h-10 font-mono text-[12.5px] text-accent">{fr.out.join("\n") || " "}</pre>
          </Box>
          <p className="text-[13px] text-fg-muted">{fr.note}</p>
        </div>
      </div>
    </VizFrame>
  );
}
