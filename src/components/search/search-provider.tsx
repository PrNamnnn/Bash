"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { OPEN_SEARCH_EVENT } from "./search-events";

const CommandPalette = dynamic(() => import("./command-palette").then((m) => m.CommandPalette), { ssr: false });

/** Global Ctrl/⌘+K listener. The palette and search index load only on first use. */
export function SearchProvider() {
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState("");
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setInitialQuery("");
        setEverOpened(true);
        setOpen((v) => !v);
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setInitialQuery("");
        setEverOpened(true);
        setOpen(true);
      }
    };
    const onOpen = (e: Event) => {
      setInitialQuery((e as CustomEvent<{ query?: string }>).detail?.query ?? "");
      setEverOpened(true);
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  if (!everOpened) return null;
  return <CommandPalette open={open} initialQuery={initialQuery} onClose={() => setOpen(false)} />;
}
