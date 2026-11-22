"use client";

import { useState, type ReactNode } from "react";
import { Pencil, Play } from "lucide-react";
import { LazyPlayground } from "@/components/playground/lazy-playground";
import { CopyButton } from "@/components/ui/copy-button";

/**
 * Shows a server-rendered code listing; the full editor + simulator only load
 * when the learner clicks Run or Edit. Zero cost for readers who just read.
 */
export function RunnableCode({ code, title, notes, children }: { code: string; title?: string; notes?: Record<number, string>; children: ReactNode }) {
  const [mode, setMode] = useState<"static" | "run" | "edit">("static");
  if (mode !== "static") {
    return (
      <div className="my-5">
        <LazyPlayground code={code} title={title ?? "example.sh"} notes={notes} autoRun={mode === "run"} minLines={Math.min(14, code.split("\n").length)} />
      </div>
    );
  }
  return (
    <div className="my-5 overflow-hidden rounded-lg border border-line bg-inset">
      <div className="flex h-9 items-center gap-1.5 border-b border-line bg-surface px-2">
        <span className="px-1 font-mono text-[11.5px] text-fg-subtle">{title ?? "bash"}</span>
        <span className="rounded bg-amber-dim px-1.5 py-0.5 text-[10px] text-amber">runnable</span>
        <CopyButton text={code} className="ml-auto" />
        <button type="button" onClick={() => setMode("edit")} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-subtle hover:bg-surface-3 hover:text-fg">
          <Pencil size={12} /> Edit
        </button>
        <button type="button" onClick={() => setMode("run")} className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[11.5px] font-medium text-accent-fg hover:bg-accent-strong">
          <Play size={11} fill="currentColor" /> Run
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-[1.6]">{children}</pre>
    </div>
  );
}
