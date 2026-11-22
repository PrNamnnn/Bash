"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Code2, FileText, FolderKanban, LayoutDashboard, Menu, SquareTerminal, Swords, Workflow, X } from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";

const ICONS: Record<string, typeof Menu> = {
  "/learn": BookOpen,
  "/dashboard": LayoutDashboard,
  "/terminal": SquareTerminal,
  "/playground": Code2,
  "/challenges": Swords,
  "/projects": FolderKanban,
  "/cheatsheets": FileText,
  "/visualize": Workflow,
};

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Close if the viewport grows past the breakpoint where the full nav appears.
    const mq = window.matchMedia("(min-width: 80rem)");
    const onResize = () => mq.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onResize);
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onResize);
      document.body.style.overflow = "";
      button?.focus();
    };
  }, [open]);

  return (
    <div className="xl:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-nav"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
      {/* Portal to <body>: the header's backdrop-filter would otherwise become the containing
          block for this fixed panel and squash it to the header's height. */}
      {open &&
        createPortal(
          <div className="fixed inset-x-0 top-[var(--header-h)] bottom-0 z-50 xl:hidden">
            <button type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} className="absolute inset-0 animate-fade-in bg-black/60" />
            <div
              ref={panelRef}
              id="mobile-nav"
              className="relative h-full w-full max-w-[320px] animate-fade-in overflow-y-auto border-r border-line bg-bg px-3 py-4 shadow-2xl"
            >
              <nav aria-label="Mobile" className="flex flex-col gap-1">
                {NAV.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = ICONS[item.href] ?? BookOpen;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] transition-colors",
                        active ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <Icon size={17} className={active ? "text-accent" : "text-fg-subtle"} aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
