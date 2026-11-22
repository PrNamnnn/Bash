import type { Metadata } from "next";
import Link from "next/link";
import { getCheatSheets } from "@/lib/content/extras";
import { allCommands } from "@/lib/content/commands";
import { CheatSheetBrowser } from "@/components/cheatsheets/cheatsheet-browser";

export const metadata: Metadata = {
  title: "Cheat sheets",
  description: "Searchable Bash reference: syntax, variables, expansions, redirection, regular expressions, scripting patterns, debugging and Linux utilities.",
};

export default function CheatSheetsPage() {
  const sections = getCheatSheets();
  const commandCount = allCommands().size;
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end">
        <div className="max-w-3xl flex-1">
          <p className="mb-2 font-mono text-[12px] text-accent">~/cheatsheets</p>
          <h1 className="text-[30px] font-semibold tracking-tight text-fg">Cheat sheets</h1>
          <p className="mt-2 text-[15px] text-fg-muted">Dense, searchable reference for everyday work. Every entry is something you will actually type.</p>
        </div>
        <Link href="/cheatsheets/commands" className="rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong">
          <span className="block text-[12px] text-fg-subtle">Full reference</span>
          <span className="block text-[14.5px] text-fg">{commandCount} commands in depth →</span>
        </Link>
      </header>
      <CheatSheetBrowser sections={sections} />
    </div>
  );
}
