"use client";

import { Search } from "lucide-react";
import { openSearch } from "./search-events";

export function SearchButton() {
  return (
    <button
      type="button"
      onClick={() => openSearch()}
      className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted"
      aria-label="Search (Ctrl+K)"
    >
      <Search size={14} />
      <span className="hidden md:inline">Search</span>
      <kbd className="hidden rounded border border-line-strong px-1 font-mono text-[10.5px] text-fg-subtle md:inline">Ctrl K</kbd>
    </button>
  );
}
