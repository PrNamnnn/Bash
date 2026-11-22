import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Clock } from "lucide-react";
import { projects, findProject } from "@/content/projects";
import { getProject, projectExists } from "@/lib/content/projects";
import { findLesson } from "@/lib/curriculum";
import { Blocks } from "@/components/content/blocks";
import { Inline } from "@/components/content/inline";
import { DifficultyBadge } from "@/components/ui/badges";
import { HintList, ProjectProgress, Reveal, StepToggle } from "@/components/projects/project-client";
import { BookmarkButton, NotesPanel } from "@/components/lesson/lesson-actions";
import { LazyPlayground } from "@/components/playground/lazy-playground";
import { Deferred } from "@/components/ui/deferred";

export function generateStaticParams() {
  return projects.filter((p) => projectExists(p.slug)).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/projects/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = findProject(slug);
  return p ? { title: `Project ${p.number}: ${p.title}`, description: p.summary } : {};
}

export default function ProjectPage({ params }: PageProps<"/projects/[slug]">) {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-[900px] animate-pulse px-4 py-10" />}>
      {params.then(({ slug }) => (
        <ProjectView slug={slug} />
      ))}
    </Suspense>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 mb-3 scroll-mt-24 text-[21px] font-semibold tracking-tight text-fg">
      {children}
    </h2>
  );
}

function ProjectView({ slug }: { slug: string }) {
  const project = getProject(slug);
  if (!project) notFound();
  const { meta } = project;
  const ctx = `Project ${meta.number}: ${meta.title}`;
  const idx = projects.findIndex((p) => p.slug === slug);
  const next = projects[idx + 1];
  const sections = [
    ["problem", "Problem"],
    ["requirements", "Requirements"],
    ["concepts", "Concepts"],
    ["steps", "Step by step"],
    ["hints", "Hints"],
    ["expected", "Expected output"],
    ["tests", "Test cases"],
    ["edge-cases", "Edge cases"],
    ["workspace", "Workspace"],
    ["solution", "Solution"],
    ["extensions", "Extensions"],
  ] as const;

  return (
    <div className="mx-auto flex max-w-[1180px] gap-10 px-4 py-10 sm:px-6">
      <article className="prose-lesson min-w-0 flex-1">
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-[12.5px] text-fg-subtle">
          <Link href="/projects" className="hover:text-fg-muted">
            Projects
          </Link>
          <ChevronRight size={12} />
          <span className="text-fg-muted">#{meta.number}</span>
        </nav>
        <header className="mb-6 border-b border-line pb-6">
          <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-fg">{meta.title}</h1>
          <p className="mt-2 text-[16px] text-fg-muted">{meta.summary}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[12.5px] text-fg-subtle">
            <DifficultyBadge level={meta.difficulty} />
            <span className="flex items-center gap-1">
              <Clock size={13} /> ~{meta.hours} h
            </span>
            <span className="ml-auto">
              <BookmarkButton id={`project:${slug}`} />
            </span>
          </div>
        </header>

        <H2 id="problem">Problem</H2>
        <Blocks blocks={project.problem} context={ctx} />

        <H2 id="requirements">Requirements</H2>
        <ol className="list-decimal space-y-1.5 pl-6 marker:text-fg-subtle">
          {project.requirements.map((r) => (
            <li key={r} className="pl-1">
              <Inline text={r} />
            </li>
          ))}
        </ol>

        <H2 id="concepts">Concepts you&apos;ll use</H2>
        <div className="flex flex-wrap gap-2">
          {project.conceptLinks.map((c) => {
            const l = findLesson(c);
            return l ? (
              <Link key={c} href={`/learn/${c}`} className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-fg-muted no-underline hover:border-accent/40 hover:text-fg">
                {l.title}
              </Link>
            ) : null;
          })}
        </div>

        <H2 id="steps">Step by step</H2>
        <ol className="space-y-4">
          {project.steps.map((s, i) => (
            <li key={s.id} className="rounded-lg border border-line bg-surface">
              <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-[12px] text-fg-muted">{i + 1}</span>
                <h3 className="flex-1 text-[15px] font-semibold text-fg">
                  <Inline text={s.title} />
                </h3>
                <StepToggle project={slug} step={s.id} title={s.title} projectTitle={meta.title} />
              </div>
              <div className="px-4 pb-1 [&>*:first-child]:mt-3">
                <Blocks blocks={s.blocks} context={ctx} />
              </div>
            </li>
          ))}
        </ol>

        {project.hints.length > 0 && (
          <>
            <H2 id="hints">Hints</H2>
            <p>Stuck? Reveal hints one at a time — try each before asking for the next.</p>
            <HintList hints={project.hints} />
          </>
        )}

        {project.expectedOutput.length > 0 && (
          <>
            <H2 id="expected">Expected output</H2>
            <Blocks blocks={project.expectedOutput} context={ctx} />
          </>
        )}

        {project.tests.length > 0 && (
          <>
            <H2 id="tests">Test cases</H2>
            <Blocks blocks={project.tests} context={ctx} />
          </>
        )}

        {project.edgeCases.length > 0 && (
          <>
            <H2 id="edge-cases">Edge cases to handle</H2>
            <ul className="list-disc space-y-1.5 pl-6 marker:text-fg-subtle">
              {project.edgeCases.map((e) => (
                <li key={e} className="pl-1">
                  <Inline text={e} />
                </li>
              ))}
            </ul>
          </>
        )}

        <H2 id="workspace">Workspace</H2>
        <p>
          Draft your solution here. The sandbox has the same files as the terminal (<code className="inline-code">~/downloads</code>, <code className="inline-code">~/logs</code>,{" "}
          <code className="inline-code">~/data</code>…). For the full experience, also run your script on a real Linux, macOS or WSL machine.
        </p>
        <Deferred minHeight={300} label="Loading workspace">
          <LazyPlayground code={`#!/usr/bin/env bash\n# ${meta.title}\nset -euo pipefail\n\n`} title={`${slug}.sh`} minLines={12} />
        </Deferred>

        <H2 id="solution">Solution</H2>
        <Reveal label="Show the complete solution" warning="Have you attempted every step? Reading a solution teaches far less than struggling with the problem first.">
          <Blocks blocks={project.solution} context={ctx} />
          <h3 className="mt-8 mb-2 text-[17px] font-semibold text-fg">How it works</h3>
          <Blocks blocks={project.explanation} context={ctx} />
        </Reveal>

        {project.extensions.length > 0 && (
          <>
            <H2 id="extensions">Improvements and extensions</H2>
            <ul className="list-disc space-y-1.5 pl-6 marker:text-fg-subtle">
              {project.extensions.map((e) => (
                <li key={e} className="pl-1">
                  <Inline text={e} />
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-10 rounded-lg border border-line bg-surface p-4 lg:hidden">
          <ProjectProgress project={slug} title={meta.title} stepIds={project.steps.map((s) => s.id)} />
        </div>
        {next && (
          <Link href={`/projects/${next.slug}`} className="mt-12 block rounded-lg border border-line px-5 py-4 no-underline transition-colors hover:border-line-strong">
            <span className="block text-[12px] text-fg-subtle">Next project →</span>
            <span className="block text-[15px] text-fg">
              #{next.number} {next.title}
            </span>
          </Link>
        )}
      </article>
      <aside className="sticky top-[calc(var(--header-h)+24px)] hidden h-fit w-[250px] shrink-0 space-y-6 lg:block">
        <ProjectProgress project={slug} title={meta.title} stepIds={project.steps.map((s) => s.id)} />
        <nav aria-label="Sections">
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">Sections</p>
          <ul className="space-y-1 border-l border-line">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-px block border-l border-transparent py-0.5 pl-3 text-[12.5px] text-fg-subtle hover:border-line-strong hover:text-fg-muted">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <NotesPanel id={`project:${slug}`} label={meta.title} />
      </aside>
    </div>
  );
}
