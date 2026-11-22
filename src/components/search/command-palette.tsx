"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { BookOpen, Box, FileCode2, FlaskConical, Hash, Layers, LayoutGrid, ScrollText, Search, SquareTerminal, Trophy } from "lucide-react";
import type { SearchItem, SearchKind } from "@/types/content";
import { cn } from "@/lib/cn";

let indexPromise: Promise<SearchItem[]> | null = null;
function loadIndex(): Promise<SearchItem[]> {
  indexPromise ??= fetch("/search-index.json")
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<SearchItem[]>;
    })
    .catch((e) => {
      indexPromise = null;
      throw e;
    });
  return indexPromise;
}

const KIND_LABEL: Record<SearchKind, string> = {
  lesson: "Lessons",
  section: "Lesson sections",
  command: "Commands",
  exercise: "Exercises",
  cheatsheet: "Cheat sheets",
  project: "Projects",
  challenge: "Challenges",
  visualization: "Visualizations",
  page: "Pages",
};

const KIND_ICON: Record<SearchKind, typeof BookOpen> = {
  lesson: BookOpen,
  section: Hash,
  command: SquareTerminal,
  exercise: FlaskConical,
  cheatsheet: ScrollText,
  project: Box,
  challenge: Trophy,
  visualization: Layers,
  page: LayoutGrid,
};

const KIND_ORDER: SearchKind[] = ["page", "lesson", "command", "section", "cheatsheet", "visualization", "project", "challenge", "exercise"];

function score(item: SearchItem, terms: string[]): number {
  const title = item.title.toLowerCase();
  const hay = `${title} ${item.context.toLowerCase()} ${item.keywords.toLowerCase()}`;
  let s = 0;
  for (const t of terms) {
    if (!hay.includes(t)) return -1;
    if (title === t) s += 120;
    else if (title.startsWith(t)) s += 60;
    else if (new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)) s += 35;
    else if (title.includes(t)) s += 20;
    else if (item.context.toLowerCase().includes(t)) s += 6;
    else s += 3;
  }
  const kindBoost: Partial<Record<SearchKind, number>> = { page: 8, lesson: 10, command: 9, section: 2, cheatsheet: 4 };
  return s + (kindBoost[item.kind] ?? 0) - title.length * 0.05;
}

export function CommandPalette({ open, initialQuery, onClose }: { open: boolean; initialQuery: string; onClose: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(query);
  const [lastOpen, setLastOpen] = useState(open);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setQuery(initialQuery);
      setActive(0);
    }
  }

  useEffect(() => {
    if (!open) return;
    loadIndex()
      .then(setItems)
      .catch(() => setError(true));
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const results = useMemo(() => {
    if (!items) return [];
    const terms = deferred.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      return items.filter((i) => i.kind === "page" || (i.kind === "lesson" && /^(what|shell|first|quoting|pipes|redirection|your-first|if)/.test(i.href.split("/").pop() ?? ""))).slice(0, 14);
    }
    return items
      .map((i) => ({ i, s: score(i, terms) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.i);
  }, [items, deferred]);

  const grouped = useMemo(() => {
    const groups = new Map<SearchKind, SearchItem[]>();
    for (const r of results) {
      const g = groups.get(r.kind) ?? [];
      if (g.length < 8) g.push(r);
      groups.set(r.kind, g);
    }
    const ordered = deferred.trim()
      ? [...groups.entries()].sort((a, b) => results.indexOf(a[1][0]) - results.indexOf(b[1][0]))
      : KIND_ORDER.filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!] as const);
    return ordered;
  }, [results, deferred]);

  const flat = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

  const go = (item: SearchItem | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-3 pt-[10vh] backdrop-blur-[2px]" onMouseDown={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-[640px] animate-fade-in overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(flat.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(flat[active]);
              }
            }}
            placeholder="Search lessons, commands, concepts, exercises…"
            className="h-12 w-full bg-transparent text-[15px] text-fg placeholder:text-fg-subtle focus:outline-none"
            aria-label="Search query"
            aria-controls="search-results"
            aria-activedescendant={flat[active] ? `sr-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
          />
          <kbd className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10.5px] text-fg-subtle">Esc</kbd>
        </div>
        <div ref={listRef} id="search-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
          {error && <p className="px-3 py-6 text-center text-sm text-red">The search index could not be loaded. Please try again.</p>}
          {!items && !error && (
            <div className="space-y-2 p-2" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-md bg-surface-2" />
              ))}
            </div>
          )}
          {items && !flat.length && <p className="px-3 py-8 text-center text-sm text-fg-subtle">No results for “{deferred}”.</p>}
          {(() => {
            let idx = -1;
            return grouped.map(([kind, list]) => (
              <div key={kind} className="mb-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{KIND_LABEL[kind]}</div>
                {list.map((item) => {
                  idx++;
                  const i = idx;
                  const Icon = KIND_ICON[item.kind] ?? FileCode2;
                  return (
                    <button
                      key={`${item.kind}-${item.href}-${item.title}`}
                      id={`sr-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(item)}
                      className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left", i === active ? "bg-surface-3" : "hover:bg-surface-2")}
                    >
                      <Icon size={15} className={cn("shrink-0", i === active ? "text-accent" : "text-fg-subtle")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-fg">{item.title}</span>
                        <span className="block truncate text-[12px] text-fg-subtle">{item.context}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11.5px] text-fg-subtle">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span className="ml-auto">{items ? `${items.length.toLocaleString()} entries` : ""}</span>
        </div>
      </div>
    </div>
  );
}
