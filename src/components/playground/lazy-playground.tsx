"use client";

import dynamic from "next/dynamic";
import type { PlaygroundProps } from "./playground";

const PlaygroundImpl = dynamic(() => import("./playground").then((m) => m.Playground), {
  ssr: false,
  loading: () => (
    <div className="overflow-hidden rounded-lg border border-line-strong bg-surface" aria-busy="true" aria-label="Loading playground">
      <div className="h-10 border-b border-line" />
      <div className="h-40 space-y-2 bg-inset p-3">
        <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
      </div>
    </div>
  ),
});

export function LazyPlayground(props: PlaygroundProps) {
  return <PlaygroundImpl {...props} />;
}
