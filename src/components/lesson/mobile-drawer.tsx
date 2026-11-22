"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft, X, ListTree } from "lucide-react";

/** Mobile-only toggles for the curriculum drawer and the on-page table of contents. */
export function MobileLessonBar({ nav, toc }: { nav: ReactNode; toc: ReactNode }) {
  const [panel, setPanel] = useState<"nav" | "toc" | null>(null);
  const pathname = usePathname();
  const [last, setLast] = useState(pathname);
  if (last !== pathname) {
    setLast(pathname);
    setPanel(null);
  }
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);
  return (
    <div className="sticky top-[var(--header-h)] z-30 -mx-4 mb-4 flex gap-2 border-b border-line bg-bg/90 px-4 py-2 backdrop-blur xl:hidden">
      <button type="button" onClick={() => setPanel(panel === "nav" ? null : "nav")} className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] text-fg-muted lg:hidden" aria-expanded={panel === "nav"}>
        <PanelLeft size={14} /> Curriculum
      </button>
      <button type="button" onClick={() => setPanel(panel === "toc" ? null : "toc")} className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] text-fg-muted" aria-expanded={panel === "toc"}>
        <ListTree size={14} /> On this page
      </button>
      {panel && (
        <div className="fixed inset-0 top-[calc(var(--header-h)+49px)] z-40 bg-black/50" onClick={() => setPanel(null)}>
          <div className="h-full w-[min(88vw,360px)] animate-fade-in overflow-y-auto border-r border-line bg-bg p-3" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPanel(null)} className="mb-2 ml-auto flex items-center gap-1 rounded px-2 py-1 text-[12px] text-fg-subtle hover:text-fg" aria-label="Close panel">
              <X size={14} /> Close
            </button>
            <div onClick={(e) => (e.target as HTMLElement).closest("a") && setPanel(null)}>{panel === "nav" ? nav : toc}</div>
          </div>
        </div>
      )}
    </div>
  );
}
