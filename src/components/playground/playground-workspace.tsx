"use client";

import { useState } from "react";
import type { PlaygroundExample } from "@/content/playground-examples";
import { LazyPlayground } from "./lazy-playground";
import { cn } from "@/lib/cn";

export function PlaygroundWorkspace({ examples }: { examples: PlaygroundExample[] }) {
  const [id, setId] = useState(examples[0].id);
  const ex = examples.find((e) => e.id === id)!;
  return (
    <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
      <nav aria-label="Example scripts" className="lg:sticky lg:top-[calc(var(--header-h)+24px)] lg:self-start">
        <p className="mb-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">Examples</p>
        <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col">
          {examples.map((e) => (
            <li key={e.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setId(e.id)}
                aria-current={e.id === id}
                className={cn("w-full rounded-md px-3 py-2 text-left text-[13px] transition-colors", e.id === id ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2")}
              >
                {e.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        <p className="mb-3 text-[14px] text-fg-muted">{ex.description}</p>
        <LazyPlayground key={ex.id} code={ex.code} args={ex.args} stdin={ex.stdin} notes={ex.notes} title={`${ex.id}.sh`} minLines={14} />
      </div>
    </div>
  );
}
