"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { CheatSection } from "@/types/content";
import { Inline } from "@/components/content/inline";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/cn";

export function CheatSheetBrowser({ sections }: { sections: CheatSection[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>("all");
  const q = useDeferredValue(query.trim().toLowerCase());
  const filtered = useMemo(
    () =>
      sections
        .filter((s) => active === "all" || s.id === active)
        .map((s) => ({
          ...s,
          groups: s.groups
            .map((g) => ({
              ...g,
              entries: g.entries.filter((e) => !q || `${e.syntax} ${e.description} ${e.example ?? ""} ${g.title} ${s.title}`.toLowerCase().includes(q)),
            }))
            .filter((g) => g.entries.length),
        }))
        .filter((s) => s.groups.length),
    [sections, q, active],
  );
  const count = filtered.reduce((n, s) => n + s.groups.reduce((k, g) => k + g.entries.length, 0), 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Cheat sheet sections" className="lg:sticky lg:top-[calc(var(--header-h)+24px)] lg:self-start">
        <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col">
          {[{ id: "all", title: "Everything" }, ...sections].map((s) => (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setActive(s.id)}
                aria-current={active === s.id}
                className={cn("w-full rounded-md px-3 py-1.5 text-left text-[13px] transition-colors", active === s.id ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2")}
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        <label className="relative mb-6 block">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
          <span className="sr-only">Search the cheat sheets</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search syntax and descriptions — e.g. 2>&1, ${var%, getopts, -mtime"
            className="h-10 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-[14px] text-fg placeholder:text-fg-subtle focus:border-accent/50 focus:outline-none"
          />
        </label>
        {q && <p className="-mt-3 mb-4 text-[12.5px] text-fg-subtle">{count} matching entries</p>}
        <div className="space-y-10">
          {filtered.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="text-[19px] font-semibold text-fg">{s.title}</h2>
              <p className="mt-1 mb-4 text-[13.5px] text-fg-muted">{s.description}</p>
              <div className="grid gap-4 xl:grid-cols-2">
                {s.groups.map((g) => (
                  <div key={g.title} className="overflow-hidden rounded-lg border border-line bg-surface">
                    <h3 className="border-b border-line bg-surface-2/60 px-4 py-2 text-[12.5px] font-semibold text-fg-muted">{g.title}</h3>
                    <ul>
                      {g.entries.map((e) => (
                        <li key={e.syntax + e.description} className="group border-b border-line/70 px-4 py-2.5 last:border-0">
                          <div className="flex items-start gap-3">
                            <code className="min-w-0 flex-1 font-mono text-[12.5px] break-words text-accent">{e.syntax}</code>
                            <CopyButton text={e.example ?? e.syntax} className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" label="Copy" />
                          </div>
                          <p className="mt-0.5 text-[13px] text-fg-muted">
                            <Inline text={e.description} />
                          </p>
                          {e.example && <code className="mt-1 block font-mono text-[12px] break-words text-fg-subtle">$ {e.example}</code>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {!filtered.length && <p className="rounded-lg border border-line px-4 py-10 text-center text-fg-subtle">Nothing matches “{query}”.</p>}
        </div>
      </div>
    </div>
  );
}
