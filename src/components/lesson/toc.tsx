"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export function Toc({ items }: { items: { id: string; title: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        const first = items.find((i) => visible.has(i.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-80px 0px -55% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);
  return (
    <nav aria-label="On this page">
      <p className="mb-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">On this page</p>
      <ul className="space-y-0.5 border-l border-line">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className={cn("-ml-px block border-l py-1 pl-3 text-[12.5px] leading-snug transition-colors", active === i.id ? "border-accent text-fg" : "border-transparent text-fg-subtle hover:text-fg-muted")}
            >
              {i.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
