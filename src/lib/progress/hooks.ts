"use client";

import { useSyncExternalStore } from "react";
import { getServerState, getState, subscribe, type ProgressState } from "./store";

/** Whole progress state. Server render and first client render see an empty state (no hydration mismatch). */
export function useProgress(): ProgressState {
  return useSyncExternalStore(subscribe, getState, getServerState);
}

/** Select a primitive slice to avoid re-rendering on unrelated changes. */
export function useProgressSelector<T extends string | number | boolean | undefined | null>(select: (s: ProgressState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(getState()),
    () => select(getServerState()),
  );
}

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
