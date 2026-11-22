"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Mount children only when they come near the viewport (keeps heavy widgets off the critical path). */
export function Deferred({ children, minHeight = 280, label = "Loading interactive content" }: { children: ReactNode; minHeight?: number; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  if (visible) return <>{children}</>;
  return <div ref={ref} style={{ minHeight }} className="my-6 rounded-lg border border-line bg-surface/50" aria-busy="true" aria-label={label} />;
}
