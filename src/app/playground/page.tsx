import type { Metadata } from "next";
import { PLAYGROUND_EXAMPLES } from "@/content/playground-examples";
import { PlaygroundWorkspace } from "@/components/playground/playground-workspace";

export const metadata: Metadata = {
  title: "Code playground",
  description: "Write and run Bash scripts in a sandboxed simulator, with arguments, stdin and line-by-line explanations.",
};

export default function PlaygroundPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6">
      <header className="mb-6 max-w-3xl">
        <p className="mb-2 font-mono text-[12px] text-accent">~/playground</p>
        <h1 className="text-[28px] font-semibold tracking-tight text-fg">Code playground</h1>
        <p className="mt-2 text-[15px] text-fg-muted">
          Edit and run Bash scripts against the sandbox filesystem. Pass arguments and standard input, and press <b className="text-fg">Explain</b> for a line-by-line walkthrough. Scripts run in an
          in-browser interpreter — nothing executes on your computer.
        </p>
      </header>
      <PlaygroundWorkspace examples={PLAYGROUND_EXAMPLES} />
    </div>
  );
}
