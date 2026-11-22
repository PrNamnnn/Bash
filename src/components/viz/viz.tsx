"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

function VizSkeleton() {
  return (
    <div className="my-6 overflow-hidden rounded-lg border border-line-strong bg-surface" aria-busy="true" aria-label="Loading visualization">
      <div className="h-10 border-b border-line" />
      <div className="h-64 animate-pulse bg-surface-2/40" />
    </div>
  );
}


/** Each visualization is its own chunk, loaded only when it appears on a page. */
const REGISTRY: Record<string, ComponentType> = {
  "command-execution": dynamic(() => import("./items/command-execution"), { ssr: false, loading: VizSkeleton }),
  "path-lookup": dynamic(() => import("./items/path-lookup"), { ssr: false, loading: VizSkeleton }),
  pipes: dynamic(() => import("./items/pipes"), { ssr: false, loading: VizSkeleton }),
  "std-streams": dynamic(() => import("./items/std-streams"), { ssr: false, loading: VizSkeleton }),
  "fd-flow": dynamic(() => import("./items/fd-flow"), { ssr: false, loading: VizSkeleton }),
  expansion: dynamic(() => import("./items/expansion"), { ssr: false, loading: VizSkeleton }),
  quoting: dynamic(() => import("./items/quoting"), { ssr: false, loading: VizSkeleton }),
  subshell: dynamic(() => import("./items/subshell"), { ssr: false, loading: VizSkeleton }),
  "process-tree": dynamic(() => import("./items/process-tree"), { ssr: false, loading: VizSkeleton }),
  jobs: dynamic(() => import("./items/jobs"), { ssr: false, loading: VizSkeleton }),
  signals: dynamic(() => import("./items/signals"), { ssr: false, loading: VizSkeleton }),
  loops: dynamic(() => import("./items/loops"), { ssr: false, loading: VizSkeleton }),
  conditionals: dynamic(() => import("./items/conditionals"), { ssr: false, loading: VizSkeleton }),
  functions: dynamic(() => import("./items/functions"), { ssr: false, loading: VizSkeleton }),
  arrays: dynamic(() => import("./items/arrays"), { ssr: false, loading: VizSkeleton }),
  permissions: dynamic(() => import("./items/permissions"), { ssr: false, loading: VizSkeleton }),
  cron: dynamic(() => import("./items/cron"), { ssr: false, loading: VizSkeleton }),
  startup: dynamic(() => import("./items/startup"), { ssr: false, loading: VizSkeleton }),
};

export function Viz({ id }: { id: string }) {
  const C = REGISTRY[id];
  if (!C) return <p className="my-4 text-sm text-red">Unknown visualization: {id}</p>;
  return <C />;
}
