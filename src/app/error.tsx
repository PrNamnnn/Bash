"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-mono text-[13px] text-red">Segmentation fault (core dumped) — just kidding.</p>
      <h1 className="mt-4 text-[26px] font-semibold text-fg">Something went wrong</h1>
      <p className="mt-2 text-[15px] text-fg-muted">This part of the page failed to load. Your progress is safe — it&apos;s stored separately in your browser.</p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-fg hover:bg-accent-strong">
          Try again
        </button>
        <Link href="/" className="rounded-md border border-line px-4 py-2 text-[14px] text-fg-muted hover:text-fg">
          Home
        </Link>
      </div>
    </div>
  );
}
