import type { Metadata } from "next";
import { projects } from "@/content/projects";
import { ProjectList } from "@/components/projects/project-list";

export const metadata: Metadata = {
  title: "Projects",
  description: "Fifteen guided Bash projects from a file organizer to a production-grade CLI, each with requirements, hints, tests and a fully explained solution.",
};

export default function ProjectsPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6">
      <header className="mb-8 max-w-3xl">
        <p className="mb-2 font-mono text-[12px] text-accent">~/projects</p>
        <h1 className="text-[30px] font-semibold tracking-tight text-fg">Guided projects</h1>
        <p className="mt-2 text-[15px] text-fg-muted">
          Real tools, built step by step. Each project has a problem statement, requirements, the concepts it draws on, a step-by-step plan with hints, test cases, edge cases, and a complete
          solution that stays hidden until you ask for it. Check off steps as you go — your progress is saved.
        </p>
      </header>
      <ProjectList projects={projects} />
    </div>
  );
}
