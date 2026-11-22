"use client";

import { useMemo, useState } from "react";
import { LazyMotion, domAnimation, m, MotionConfig, AnimatePresence } from "motion/react";
import { runScript } from "@/lib/shell";
import { Segmented, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

const PIPELINES = {
  ips: ["cat logs/access.log", "grep ' 404 '", "awk '{print $1}'", "sort", "uniq -c", "sort -rn"],
  errors: ["cat logs/app.log", "grep ERROR", "sed -E 's/.*\\[([a-z]+)\\].*/\\1/'", "sort", "uniq -c"],
  sales: ["cat data/sales.csv", "tail -n +2", "cut -d, -f2,4", "tr , ' '", "sort -k2 -n", "tail -3"],
} as const;

type Key = keyof typeof PIPELINES;

export default function PipesViz() {
  const [key, setKey] = useState<Key>("ips");
  const [active, setActive] = useState(0);
  const stages = PIPELINES[key];
  const outputs = useMemo(
    () =>
      stages.map((_, i) => {
        const r = runScript({ code: stages.slice(0, i + 1).join(" | "), fixture: "default" });
        return r.stdout;
      }),
    [stages],
  );
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setActive(0);
  }
  const out = outputs[active] ?? "";
  const lines = out.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === ""));

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <VizFrame
          title="Data flowing through a pipeline"
          footer="Each command reads the previous command's stdout as its stdin. All stages start at the same time on a real system; data streams through as it is produced. Click a stage to inspect the data leaving it."
        >
          <div className="mb-4">
            <Segmented
              label="Pipeline"
              value={key}
              onChange={setKey}
              options={[
                { value: "ips", label: "404s by IP" },
                { value: "errors", label: "errors by module" },
                { value: "sales", label: "top sales" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-center">
            {stages.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5 md:contents">
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-pressed={active === i}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-left font-mono text-[12px] transition-colors",
                    active === i ? "border-accent/60 bg-accent-dim/50 text-fg" : i < active ? "border-accent/20 bg-surface-2 text-fg-muted" : "border-line bg-surface-2 text-fg-muted hover:border-line-strong",
                  )}
                >
                  {s}
                  <span className="ml-2 text-[10.5px] text-fg-subtle">{outputs[i] ? outputs[i].split("\n").filter(Boolean).length : 0} lines</span>
                </button>
                {i < stages.length - 1 && (
                  <span className="relative px-1 font-mono text-[13px] text-violet" aria-hidden>
                    |
                    {i < active && (
                      <m.span
                        className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                        animate={{ opacity: [0.2, 1, 0.2] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
                      />
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-md border border-line bg-inset">
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] text-fg-subtle">
              <span>
                stdout of stage {active + 1}: <code className="font-mono text-fg-muted">{stages[active]}</code>
              </span>
              <span>{lines.length} lines</span>
            </div>
            <AnimatePresence mode="wait">
              <m.pre
                key={`${key}-${active}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="max-h-56 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55] whitespace-pre text-fg-muted"
              >
                {lines.slice(0, 40).join("\n")}
                {lines.length > 40 && `\n… ${lines.length - 40} more lines`}
              </m.pre>
            </AnimatePresence>
          </div>
        </VizFrame>
      </LazyMotion>
    </MotionConfig>
  );
}
