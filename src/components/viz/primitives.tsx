"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Play, Pause } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Inline } from "@/components/content/inline";

export function VizFrame({ title, children, footer, className }: { title: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <figure className={cn("my-6 overflow-hidden rounded-lg border border-line-strong bg-surface", className)} aria-label={title}>
      <figcaption className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-violet" aria-hidden />
        <span className="text-[13px] font-medium text-fg">{title}</span>
        <span className="ml-auto text-[11px] text-fg-subtle">interactive</span>
      </figcaption>
      <div className="p-4">{children}</div>
      {footer && <div className="border-t border-line px-4 py-2.5 text-[12.5px] leading-relaxed text-fg-muted">{typeof footer === "string" ? <Inline text={footer} /> : footer}</div>}
    </figure>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = "sm" }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; size?: "sm" | "xs" }) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-md border border-line bg-inset p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "shrink-0 rounded px-2.5 font-mono transition-colors",
            size === "sm" ? "py-1 text-[12px]" : "py-0.5 text-[11px]",
            value === o.value ? "bg-surface-3 text-fg" : "text-fg-subtle hover:text-fg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Prev/next/play controls for step-through visualizations. */
export function useStepper(count: number, deps: unknown[] = []) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const depKey = JSON.stringify(deps);
  const [lastKey, setLastKey] = useState(depKey);
  if (lastKey !== depKey) {
    setLastKey(depKey);
    setStep(0);
    setPlaying(false);
  }
  useEffect(() => {
    if (!playing) return;
    const atEnd = step >= count - 1;
    const t = setTimeout(() => (atEnd ? setPlaying(false) : setStep((s) => Math.min(count - 1, s + 1))), atEnd ? 0 : 1100);
    return () => clearTimeout(t);
  }, [playing, step, count]);
  return { step, setStep, playing, setPlaying };
}

export function StepControls({ step, count, setStep, playing, setPlaying, label }: { step: number; count: number; setStep: (n: number) => void; playing: boolean; setPlaying: (b: boolean) => void; label?: string }) {
  const b = "grid h-7 w-7 place-items-center rounded-md border border-line text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-30";
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={b} onClick={() => setStep(0)} aria-label="Restart" disabled={step === 0}>
        <RotateCcw size={13} />
      </button>
      <button type="button" className={b} onClick={() => setStep(Math.max(0, step - 1))} aria-label="Previous step" disabled={step === 0}>
        <ChevronLeft size={14} />
      </button>
      <button type="button" className={b} onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"} disabled={step >= count - 1 && !playing}>
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <button type="button" className={b} onClick={() => setStep(Math.min(count - 1, step + 1))} aria-label="Next step" disabled={step >= count - 1}>
        <ChevronRight size={14} />
      </button>
      <span className="ml-1 text-[11.5px] text-fg-subtle tabular-nums" aria-live="polite">
        {label ?? "Step"} {step + 1}/{count}
      </span>
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn("font-mono text-[12.5px]", className)}>{children}</code>;
}

export function Box({ title, children, active, className, tone = "default" }: { title?: ReactNode; children: ReactNode; active?: boolean; className?: string; tone?: "default" | "accent" | "red" | "amber" | "blue" | "violet" }) {
  const tones = {
    default: "border-line bg-surface-2",
    accent: "border-accent/40 bg-accent-dim/30",
    red: "border-red/40 bg-red-dim/30",
    amber: "border-amber/40 bg-amber-dim/30",
    blue: "border-blue/40 bg-blue-dim/40",
    violet: "border-violet/40 bg-violet-dim/30",
  };
  return (
    <div className={cn("rounded-md border p-3 transition-colors", active ? "border-accent/60 bg-accent-dim/40" : tones[tone], className)}>
      {title && <div className="mb-1.5 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{title}</div>}
      {children}
    </div>
  );
}
