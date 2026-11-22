"use client";

import { useMemo, useState } from "react";
import { runScript } from "@/lib/shell";
import { Segmented, StepControls, useStepper, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

interface Preset {
  setup: string;
  line: string;
  stages: { name: string; result: string; note: string }[];
}

const YEAR = String(new Date().getFullYear());

const PRESETS: Record<string, Preset> = {
  backup: {
    setup: 'name="my notes"; mkdir -p /tmp/x && cd /tmp/x && touch a.txt b.txt',
    line: 'cp ~/$name.{txt,bak} *.txt "$(date +%Y)"',
    stages: [
      { name: "Brace", result: "cp ~/$name.txt ~/$name.bak *.txt \"$(date +%Y)\"", note: "{txt,bak} generates two words. Brace expansion is purely textual and happens first." },
      { name: "Tilde", result: "cp /home/learner/$name.txt /home/learner/$name.bak *.txt \"$(date +%Y)\"", note: "An unquoted ~ at the start of a word becomes $HOME." },
      { name: "Parameter", result: "cp /home/learner/my notes.txt /home/learner/my notes.bak *.txt \"$(date +%Y)\"", note: "$name is replaced by its value — including the space." },
      { name: "Command subst.", result: `cp /home/learner/my notes.txt /home/learner/my notes.bak *.txt "${YEAR}"`, note: "$(date +%Y) runs date and substitutes its output." },
      { name: "Word splitting", result: `[cp] [/home/learner/my] [notes.txt] [/home/learner/my] [notes.bak] [*.txt] [${YEAR}]`, note: "Unquoted results of expansions are split on spaces/tabs/newlines (IFS). The quoted $(…) stays one word — but $name was unquoted, so 'my notes' broke into two!" },
      { name: "Globbing", result: `[cp] [/home/learner/my] [notes.txt] [/home/learner/my] [notes.bak] [a.txt] [b.txt] [${YEAR}]`, note: "*.txt matches files in the current directory." },
      { name: "Quote removal", result: `argv: cp · /home/learner/my · notes.txt · /home/learner/my · notes.bak · a.txt · b.txt · ${YEAR}`, note: "Remaining quote characters are removed. cp receives 7 arguments instead of the intended 5: the bug is the unquoted $name." },
    ],
  },
  count: {
    setup: "set -- one 'two words' three",
    line: 'echo $# "$@" $((1+2)) {a..c}',
    stages: [
      { name: "Brace", result: 'echo $# "$@" $((1+2)) a b c', note: "{a..c} is a sequence expression." },
      { name: "Tilde", result: 'echo $# "$@" $((1+2)) a b c', note: "No tildes here — nothing changes." },
      { name: "Parameter", result: 'echo 3 "one" "two words" "three" $((1+2)) a b c', note: '$# is the argument count. "$@" expands to each argument as a separate quoted word.' },
      { name: "Arithmetic", result: 'echo 3 "one" "two words" "three" 3 a b c', note: "$(( )) evaluates integer arithmetic. It happens at the same stage as parameter and command substitution." },
      { name: "Word splitting", result: "[echo] [3] [one] [two words] [three] [3] [a] [b] [c]", note: 'Quoted "$@" elements are not split: "two words" survives.' },
      { name: "Globbing", result: "[echo] [3] [one] [two words] [three] [3] [a] [b] [c]", note: "No glob characters, nothing to match." },
      { name: "Quote removal", result: "argv: echo · 3 · one · two words · three · 3 · a · b · c", note: "echo receives 8 arguments and prints them separated by single spaces." },
    ],
  },
};

export default function ExpansionViz() {
  const [key, setKey] = useState<keyof typeof PRESETS | "custom">("backup");
  const [custom, setCustom] = useState('x="a  b*"; printf "<%s>\\n" $x "$x"');
  const preset = key === "custom" ? null : PRESETS[key];
  const s = useStepper(preset ? preset.stages.length : 1, [key]);
  const live = useMemo(() => {
    if (key !== "custom") return null;
    const r = runScript({ code: custom, fixture: "default" });
    return r.stdout + r.stderr;
  }, [key, custom]);
  const final = useMemo(() => {
    if (!preset) return null;
    const r = runScript({ code: `${preset.setup}; printf '[%s] ' ${preset.line.replace(/^\w+ /, "")}; echo`, fixture: "default" });
    return r.stdout.trim();
  }, [preset]);

  return (
    <VizFrame title="Shell expansion stages" footer="Order: brace → tilde → parameter / command / arithmetic (left to right) → word splitting → pathname expansion → quote removal.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Example"
          value={key}
          onChange={setKey}
          options={[
            { value: "backup", label: "the space bug" },
            { value: "count", label: '$# and "$@"' },
            { value: "custom", label: "try your own" },
          ]}
        />
        {preset && <StepControls {...s} count={preset.stages.length} label="Stage" />}
      </div>
      {preset ? (
        <>
          <div className="mb-3 rounded-md border border-line bg-inset px-3 py-2 font-mono text-[12.5px] text-fg-subtle">
            <div># {preset.setup}</div>
            <div className="text-fg">
              <span className="text-accent">$ </span>
              {preset.line}
            </div>
          </div>
          <ol className="space-y-1.5">
            {preset.stages.map((st, i) => (
              <li key={st.name}>
                <button
                  type="button"
                  onClick={() => s.setStep(i)}
                  className={cn("grid w-full grid-cols-[7.5rem_1fr] gap-3 rounded-md border px-3 py-2 text-left transition-colors", i === s.step ? "border-accent/50 bg-accent-dim/30" : i < s.step ? "border-line bg-surface-2/60" : "border-line/50 opacity-50")}
                >
                  <span className="text-[12px] font-medium text-fg-muted">
                    {i + 1}. {st.name}
                  </span>
                  <span className="font-mono text-[12px] break-all text-fg">{i <= s.step ? st.result : "…"}</span>
                </button>
                {i === s.step && <p className="mt-1 mb-2 pl-[8.25rem] text-[13px] text-fg-muted max-md:pl-3">{st.note}</p>}
              </li>
            ))}
          </ol>
          {final && s.step === preset.stages.length - 1 && (
            <p className="mt-3 text-[12px] text-fg-subtle">
              Verified in the simulator: <code className="font-mono text-accent">{final}</code>
            </p>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <label className="block text-[12px] text-fg-subtle">
            Write any command — use <code className="inline-code">printf &quot;&lt;%s&gt;\n&quot; …</code> to see each resulting argument on its own line:
            <textarea
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              rows={3}
              spellCheck={false}
              className="mt-1 block w-full rounded-md border border-line bg-inset px-3 py-2 font-mono text-[13px] text-fg focus:border-accent/50 focus:outline-none"
            />
          </label>
          <pre className="max-h-48 overflow-auto rounded-md border border-line bg-inset px-3 py-2 font-mono text-[12.5px] whitespace-pre-wrap text-fg-muted">{live || "(no output)"}</pre>
        </div>
      )}
    </VizFrame>
  );
}
