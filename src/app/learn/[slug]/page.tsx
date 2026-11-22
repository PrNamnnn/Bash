import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock, Target, ChevronRight } from "lucide-react";
import { allLessons, formatMinutes, locateLesson, findLesson } from "@/lib/curriculum";
import { getLesson, lessonExists } from "@/lib/content/lessons";
import { navLevels } from "@/lib/content/nav-data";
import { Blocks } from "@/components/content/blocks";
import { Inline } from "@/components/content/inline";
import { CurriculumNav } from "@/components/lesson/curriculum-nav";
import { Toc } from "@/components/lesson/toc";
import { MobileLessonBar } from "@/components/lesson/mobile-drawer";
import { BookmarkButton, CompleteButton, ExerciseProgress, NotesPanel, VisitTracker } from "@/components/lesson/lesson-actions";
import { DifficultyBadge } from "@/components/ui/badges";

export function generateStaticParams() {
  return allLessons()
    .filter((l) => lessonExists(l.slug))
    .map((l) => ({ slug: l.slug }));
}


export async function generateMetadata({ params }: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const l = findLesson(slug);
  if (!l) return {};
  return { title: l.title, description: l.summary };
}

export default function LessonPage({ params }: PageProps<"/learn/[slug]">) {
  return (
    <Suspense fallback={<LessonSkeleton />}>
      {params.then(({ slug }) => (
        <LessonView slug={slug} />
      ))}
    </Suspense>
  );
}

function LessonSkeleton() {
  return (
    <div className="mx-auto max-w-[760px] px-4 py-10" aria-busy="true">
      <div className="h-8 w-2/3 animate-pulse rounded bg-surface-2" />
      <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-surface-2" />
      <div className="mt-10 h-40 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}

function LessonView({ slug }: { slug: string }) {
  const loc = locateLesson(slug);
  const lesson = getLesson(slug);
  if (!loc || !lesson) notFound();

  const tocItems = [
    { id: "objectives", title: "Learning objectives" },
    ...lesson.sections.map((s) => ({ id: s.id, title: s.title })),
    ...(lesson.summary.length ? [{ id: "summary", title: "Summary" }] : []),
  ];
  const nav = <CurriculumNav levels={navLevels()} current={slug} />;
  const toc = <Toc items={tocItems} />;
  const related = lesson.related.map((r) => findLesson(r)).filter((r): r is NonNullable<typeof r> => !!r);

  return (
    <div className="mx-auto flex max-w-[1440px] gap-8 px-4 sm:px-6">
      <VisitTracker slug={slug} />
      <aside className="sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] w-[272px] shrink-0 overflow-y-auto border-r border-line py-6 pr-3 lg:block">{nav}</aside>

      <article className="min-w-0 flex-1 py-6 lg:py-10">
        <MobileLessonBar nav={nav} toc={toc} />
        <div className="mx-auto max-w-[760px]">
          <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-[12.5px] text-fg-subtle">
            <Link href="/learn" className="hover:text-fg-muted">
              Curriculum
            </Link>
            <ChevronRight size={12} />
            <Link href={`/learn#${loc.level.id}`} className="hover:text-fg-muted">
              Level {loc.level.number}: {loc.level.title}
            </Link>
            <ChevronRight size={12} />
            <span className="text-fg-muted">{loc.module.title}</span>
          </nav>

          <header className="mb-8 border-b border-line pb-6">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg sm:text-[32px]">{lesson.meta.title}</h1>
            <p className="mt-2 text-[16px] text-fg-muted">{lesson.meta.summary}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-[12.5px] text-fg-subtle">
              <DifficultyBadge level={lesson.meta.difficulty} />
              <span className="flex items-center gap-1">
                <Clock size={13} /> {formatMinutes(lesson.meta.minutes)}
              </span>
              <span>
                Lesson {loc.index + 1} of {allLessons().length}
              </span>
              <span className="ml-auto">
                <BookmarkButton id={`lesson:${slug}`} />
              </span>
            </div>
          </header>

          <div className="prose-lesson">
            <section id="objectives" className="scroll-mt-28 rounded-lg border border-line bg-surface px-5 py-4">
              <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-fg-subtle uppercase">
                <Target size={14} className="text-accent" /> Learning objectives
              </h2>
              <ul className="space-y-1.5">
                {lesson.objectives.map((o) => (
                  <li key={o} className="flex gap-2.5 text-[14.5px]">
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>
                      <Inline text={o} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {lesson.sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-28">
                <h2 className="mt-12 mb-3 text-[22px] font-semibold tracking-tight text-fg">
                  <a href={`#${s.id}`} className="no-underline hover:text-fg">
                    <Inline text={s.title} />
                  </a>
                </h2>
                <Blocks blocks={s.blocks} context={lesson.meta.title} />
              </section>
            ))}

            {lesson.summary.length > 0 && (
              <section id="summary" className="mt-12 scroll-mt-28 rounded-lg border border-accent/25 bg-accent-dim/15 px-5 py-4">
                <h2 className="mb-2 text-[18px] font-semibold text-fg">Summary</h2>
                <ul className="list-disc space-y-1.5 pl-5 marker:text-accent">
                  {lesson.summary.map((s) => (
                    <li key={s}>
                      <Inline text={s} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {related.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-fg-subtle uppercase">Related lessons</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {related.map((r) => (
                  <Link key={r.slug} href={`/learn/${r.slug}`} className="rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong">
                    <span className="block text-[11.5px] text-fg-subtle">Level {r.levelNumber}</span>
                    <span className="block text-[14px] text-fg">{r.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="mt-10">
            <CompleteButton slug={slug} title={lesson.meta.title} next={loc.next ? { slug: loc.next.slug, title: loc.next.title } : undefined} />
          </div>

          {/* On narrower screens the right rail is hidden; show progress and notes inline instead. */}
          <section aria-label="Your progress and notes" className="mt-8 space-y-6 rounded-lg border border-line bg-surface p-4 xl:hidden">
            <ExerciseProgress ids={lesson.exercises.map((e) => e.id)} />
            <NotesPanel id={`lesson:${slug}`} label={lesson.meta.title} />
          </section>

          <nav aria-label="Lesson navigation" className="mt-6 mb-10 grid gap-3 sm:grid-cols-2">
            {loc.prev ? (
              <Link href={`/learn/${loc.prev.slug}`} className="group rounded-lg border border-line px-4 py-3 transition-colors hover:border-line-strong">
                <span className="flex items-center gap-1 text-[12px] text-fg-subtle">
                  <ArrowLeft size={13} /> Previous
                </span>
                <span className="block text-[14px] text-fg-muted group-hover:text-fg">{loc.prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {loc.next && (
              <Link href={`/learn/${loc.next.slug}`} className="group rounded-lg border border-line px-4 py-3 text-right transition-colors hover:border-line-strong">
                <span className="flex items-center justify-end gap-1 text-[12px] text-fg-subtle">
                  Next <ArrowRight size={13} />
                </span>
                <span className="block text-[14px] text-fg-muted group-hover:text-fg">{loc.next.title}</span>
              </Link>
            )}
          </nav>
        </div>
      </article>

      <aside className="sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] w-[240px] shrink-0 space-y-6 overflow-y-auto py-10 xl:block">
        {toc}
        <ExerciseProgress ids={lesson.exercises.map((e) => e.id)} />
        <NotesPanel id={`lesson:${slug}`} label={lesson.meta.title} />
      </aside>
    </div>
  );
}
