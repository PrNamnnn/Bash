import Link from "next/link";
import { ArrowRight, SquareTerminal, Layers, FlaskConical, Box, ScrollText, HardDrive } from "lucide-react";
import { curriculum } from "@/content/curriculum";
import { projects } from "@/content/projects";
import { allLessons, formatMinutes, totalMinutes } from "@/lib/curriculum";
import { LazyTerminal } from "@/components/terminal/lazy-terminal";
import { HomeContinue } from "@/components/dashboard/home-continue";
import { DifficultyBadge } from "@/components/ui/badges";
import { VIZ } from "@/lib/viz-meta";

const PILLARS = [
  { icon: SquareTerminal, title: "A real shell language, in your browser", text: "A Bash interpreter written from scratch in TypeScript: quoting, expansions, pipes, redirection, here-docs, functions, arrays, traps and 70+ utilities including grep, sed, awk and find — sandboxed against a virtual filesystem." },
  { icon: Layers, title: "See what the shell does", text: `${VIZ.length} interactive visualizations: how a command executes, PATH lookup, data in pipelines, file descriptor tables, expansion order, subshells, signals and job control.` },
  { icon: FlaskConical, title: "Practice that checks itself", text: "Predict the output, find the bug, fill the blanks, write a command, complete a script. Command exercises run your answer in the simulator and compare the result." },
  { icon: Box, title: "Projects, not just snippets", text: "Fifteen guided builds — log analyzer, backup manager, deploy script, production CLI — with requirements, tests, edge cases and explained solutions." },
  { icon: ScrollText, title: "Correct, not just convenient", text: "Every lesson separates Bash features from POSIX sh, GNU tools from macOS/BSD behaviour, and explains the pitfalls of popular shortcuts like `set -e`." },
  { icon: HardDrive, title: "Yours, offline-first", text: "No account, no tracking, no server. Progress, notes, bookmarks and streaks live in your browser and can be exported any time." },
];

export default function Home() {
  const lessons = allLessons();
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-20 lg:pb-20">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-[12px] text-fg-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {lessons.length} lessons · {curriculum.length} levels · 15 projects
            </p>
            <h1 className="text-[38px] leading-[1.08] font-semibold tracking-tight text-fg sm:text-[48px]">
              Learn Bash from your
              <br />
              first command to
              <br />
              <span className="text-accent">production automation.</span>
            </h1>
            <p className="mt-5 max-w-[560px] text-[16.5px] leading-relaxed text-fg-muted">
              A complete, hands-on course for people who have never opened a terminal — and for developers who use one daily but never learned how the shell really works. Read, run,
              break things in a sandbox, and build real tools.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/learn/operating-systems-and-linux" className="group flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-[15px] font-medium text-accent-fg transition-colors hover:bg-accent-strong">
                Start from zero <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link href="/learn" className="flex h-11 items-center rounded-lg border border-line px-5 text-[15px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg">
                Browse the curriculum
              </Link>
            </div>
            <HomeContinue />
          </div>
          <div>
            <LazyTerminal
              height="300px"
              welcome
              title="learner@bash-mastery: ~ — try it"
              suggestions={["ls", "cat notes.txt", "grep -c ERROR logs/app.log", "awk '{print $1}' logs/access.log | sort | uniq -c | sort -rn | head -3", "for f in photos/*; do echo \"${f##*/}\"; done"]}
            />
            <p className="mt-2 text-[12px] text-fg-subtle">Sandboxed simulator — click a suggestion or type your own command.</p>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
          <h2 className="max-w-2xl text-[26px] font-semibold tracking-tight text-fg">Built for understanding, not memorising</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-fg-muted">Most shell bugs come from not knowing what the shell does before a command runs. This course makes that visible.</p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.title} className="bg-bg p-6">
                <p.icon size={20} className="text-accent" />
                <h3 className="mt-4 text-[15px] font-semibold text-fg">{p.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{p.text.replace(/`/g, "")}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[26px] font-semibold tracking-tight text-fg">The roadmap</h2>
              <p className="mt-2 max-w-2xl text-[15px] text-fg-muted">
                Fourteen levels, about {formatMinutes(totalMinutes(lessons))} of lessons. Each one builds on the last — from what an operating system is to concurrency, security and CI/CD.
              </p>
            </div>
            <Link href="/learn" className="flex items-center gap-1 text-[14px] text-accent hover:underline">
              Full curriculum <ArrowRight size={14} />
            </Link>
          </div>
          <ol className="mt-10 grid gap-3 md:grid-cols-2">
            {curriculum.map((l) => {
              const count = l.modules.reduce((n, m) => n + m.lessons.length, 0);
              return (
                <li key={l.id}>
                  <Link href={`/learn#${l.id}`} className="group flex items-start gap-4 rounded-xl border border-line bg-surface px-5 py-4 transition-colors hover:border-line-strong">
                    <span className="font-mono text-[20px] leading-none font-semibold text-fg-subtle group-hover:text-accent">{String(l.number).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold text-fg">{l.title}</span>
                        <DifficultyBadge level={l.difficulty} />
                      </span>
                      <span className="mt-0.5 block text-[13px] text-fg-muted">{l.tagline}</span>
                      <span className="mt-2 block font-mono text-[11.5px] text-fg-subtle">
                        {count} lesson{count === 1 ? "" : "s"} · {l.modules.flatMap((m) => m.lessons.flatMap((x) => x.tags.slice(0, 2))).slice(0, 6).join("  ")}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Projects */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
          <h2 className="text-[26px] font-semibold tracking-tight text-fg">Things you will build</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-fg-muted">Every project starts from a real problem and ends with a script you could put in production.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.slice(0, 15).filter((_, i) => [0, 3, 5, 9, 11, 14].includes(i)).map((p) => (
              <Link key={p.slug} href={`/projects/${p.slug}`} className="group rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-fg-subtle">#{String(p.number).padStart(2, "0")}</span>
                  <DifficultyBadge level={p.difficulty} />
                </div>
                <h3 className="mt-3 text-[15.5px] font-semibold text-fg group-hover:text-accent">{p.title}</h3>
                <p className="mt-1 text-[13.5px] text-fg-muted">{p.summary}</p>
              </Link>
            ))}
          </div>
          <Link href="/projects" className="mt-6 inline-flex items-center gap-1 text-[14px] text-accent hover:underline">
            All 15 projects <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-[1240px] px-4 py-20 text-center sm:px-6">
          <p className="font-mono text-[13px] text-fg-subtle">$ cd ~/learn && ./start.sh</p>
          <h2 className="mt-3 text-[30px] font-semibold tracking-tight text-fg">Ten minutes from now you&apos;ll have run your first commands.</h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/learn/operating-systems-and-linux" className="flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-[15px] font-medium text-accent-fg hover:bg-accent-strong">
              Start Level 0 <ArrowRight size={16} />
            </Link>
            <Link href="/terminal" className="flex h-11 items-center rounded-lg border border-line px-5 text-[15px] text-fg-muted hover:border-line-strong hover:text-fg">
              Open the terminal
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
