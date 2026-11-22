import type { Metadata } from "next";
import Link from "next/link";
import { allCommands } from "@/lib/content/commands";
import { CommandCard } from "@/components/content/command-card";
import { compareNames } from "@/lib/shell/vfs";

export const metadata: Metadata = {
  title: "Command reference",
  description: "In-depth reference for every command taught in the course: purpose, syntax, options, examples, real-world uses, common mistakes and portability notes.",
};

export default function CommandsReferencePage() {
  const cmds = [...allCommands().values()].sort((a, b) => compareNames(a.name, b.name));
  const byCategory = new Map<string, typeof cmds>();
  for (const c of cmds) byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
  return (
    <div className="mx-auto max-w-[920px] px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="mb-2 font-mono text-[12px] text-accent">
          <Link href="/cheatsheets" className="hover:underline">
            ~/cheatsheets
          </Link>
          /commands
        </p>
        <h1 className="text-[30px] font-semibold tracking-tight text-fg">Command reference</h1>
        <p className="mt-2 text-[15px] text-fg-muted">
          {cmds.length} commands, each explained the same way: what it does, why it exists, syntax, options, examples, real uses, mistakes and related commands. Badges show whether
          something is part of Bash, a POSIX utility, a GNU tool or Linux-specific.
        </p>
        <nav aria-label="Commands by category" className="mt-6 space-y-2">
          {[...byCategory.entries()].map(([cat, list]) => (
            <div key={cat} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="w-32 shrink-0 text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">{cat}</span>
              {list.map((c) => (
                <a key={c.name} href={`#cmd-${c.name}`} className="rounded border border-line px-1.5 py-0.5 font-mono text-[12px] text-fg-muted hover:border-accent/40 hover:text-fg">
                  {c.name}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </header>
      <div className="prose-lesson">
        {cmds.map((c) => (
          <CommandCard key={c.name} doc={c} />
        ))}
      </div>
    </div>
  );
}
