"use client";

import dynamic from "next/dynamic";
import type { TerminalProps } from "./terminal";

function TerminalSkeleton({ height = "340px" }: { height?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line-strong bg-inset" aria-busy="true" aria-label="Loading terminal">
      <div className="h-9 border-b border-line bg-surface" />
      <div className="space-y-2 p-3" style={{ height }}>
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
      </div>
    </div>
  );
}

const TerminalImpl = dynamic(() => import("./terminal").then((m) => m.Terminal), {
  ssr: false,
  loading: () => <TerminalSkeleton />,
});

/** Code-split terminal: the simulator bundle loads only when a terminal is rendered. */
export function LazyTerminal(props: TerminalProps) {
  return <TerminalImpl {...props} />;
}
