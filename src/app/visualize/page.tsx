import type { Metadata } from "next";
import Link from "next/link";
import { VIZ } from "@/lib/viz-meta";
import { findLesson } from "@/lib/curriculum";
import { Viz } from "@/components/viz/viz";
import { Deferred } from "@/components/ui/deferred";

export const metadata: Metadata = {
  title: "Visualizations",
  description: "Interactive visual explanations of how Bash works: execution, PATH lookup, pipes, file descriptors, expansion, processes, signals, loops and more.",
};

export default function VisualizePage() {
  return (
    <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6">
      <header className="mb-8 max-w-3xl">
        <p className="mb-2 font-mono text-[12px] text-accent">~/visualize</p>
        <h1 className="text-[30px] font-semibold tracking-tight text-fg">Visual explanations</h1>
        <p className="mt-2 text-[15px] text-fg-muted">
          {VIZ.length} interactive models of what the shell does behind the scenes. Many of them run real commands through the in-browser Bash simulator, so what you see is what Bash
          produces.
        </p>
        <nav aria-label="Visualizations" className="mt-5 flex flex-wrap gap-1.5">
          {VIZ.map((v) => (
            <a key={v.id} href={`#${v.id}`} className="rounded-md border border-line px-2 py-1 text-[12px] text-fg-muted hover:border-line-strong hover:text-fg">
              {v.title}
            </a>
          ))}
        </nav>
      </header>
      <div className="space-y-14">
        {VIZ.map((v) => {
          const lesson = findLesson(v.lesson);
          return (
            <section key={v.id} id={v.id} className="scroll-mt-24">
              <h2 className="text-[19px] font-semibold text-fg">{v.title}</h2>
              <p className="mt-1 text-[14px] text-fg-muted">
                {v.description}{" "}
                {lesson && (
                  <Link href={`/learn/${lesson.slug}`} className="text-accent hover:underline">
                    Lesson: {lesson.title} →
                  </Link>
                )}
              </p>
              <Deferred minHeight={340} label={`Loading ${v.title}`}>
                <Viz id={v.id} />
              </Deferred>
            </section>
          );
        })}
      </div>
    </div>
  );
}
