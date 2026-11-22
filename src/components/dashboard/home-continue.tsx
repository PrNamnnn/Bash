"use client";

import Link from "next/link";
import { useHydrated, useProgress } from "@/lib/progress/hooks";

/** Shows a "continue" link on the home page for returning learners. */
export function HomeContinue() {
  const p = useProgress();
  const hydrated = useHydrated();
  const count = hydrated ? Object.keys(p.lessons).length : 0;
  return (
    <p className="mt-5 h-5 text-[13px] text-fg-subtle">
      {hydrated && p.lastLesson ? (
        <>
          Welcome back — {count} lesson{count === 1 ? "" : "s"} completed.{" "}
          <Link href={`/learn/${p.lastLesson.slug}`} className="text-accent hover:underline">
            Continue where you left off →
          </Link>
        </>
      ) : (
        "No sign-up. Progress is saved in your browser."
      )}
    </p>
  );
}
