import Link from "next/link";
import type { CommandDoc } from "@/types/content";
import { Inline } from "./inline";
import { CodeBlock } from "./code-block";
import { TriangleExclamationPoint } from "lucide-react";

const ORIGIN_LABEL: Record<CommandDoc["origin"], { label: string; cls: string; title: string }> = {
  "bash-builtin": { label: "Bash builtin", cls: "text-violet bg-violet-dim/70", title: "Part of Bash itself — runs inside the shell process" },
  "posix-utility": { label: "POSIX utility", cls: "text-accent bg-accent-dim/70", title: "Specified by POSIX; available on Linux, macOS and BSD" },
  "gnu-coreutils": { label: "GNU coreutils", cls: "text-blue bg-blue-dim/70", title: "GNU implementation; flags may differ on macOS/BSD" },
  "linux-specific": { label: "Linux-specific", cls: "text-amber bg-amber-dim/70", title: "Linux tool — not a Bash feature and not on macOS" },
  "external-tool": { label: "Separate package", cls: "text-fg-muted bg-surface-3", title: "Usually installed separately" },
};

export function CommandCard({ doc }: { doc: CommandDoc }) {
  const o = ORIGIN_LABEL[doc.origin];
  return (
    <section id={`cmd-${doc.name}`} className="my-8 scroll-mt-24 overflow-hidden rounded-lg border border-line-strong bg-surface" aria-labelledby={`cmd-${doc.name}-title`}>
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface-2/60 px-4 py-3">
        <h3 id={`cmd-${doc.name}-title`} className="font-mono text-[17px] font-semibold text-fg">
          {doc.name}
        </h3>
        <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${o.cls}`} title={o.title}>
          {o.label}
        </span>
        <p className="w-full text-[14px] text-fg-muted sm:ml-1 sm:w-auto">
          <Inline text={doc.summary} />
        </p>
      </header>
      <div className="space-y-5 px-4 py-4">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h4 className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">Why it exists</h4>
            <p className="prose-lesson text-[14px]">
              <Inline text={doc.why} />
            </p>
          </div>
          <div>
            <h4 className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">Syntax</h4>
            <div className="space-y-1">
              {doc.syntax.map((s) => (
                <code key={s} className="block rounded-md border border-line bg-inset px-2.5 py-1.5 font-mono text-[12.5px] text-fg">
                  {s}
                </code>
              ))}
            </div>
          </div>
        </div>

        {doc.flags.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">Common options</h4>
            <div className="overflow-hidden rounded-md border border-line">
              <table className="w-full border-collapse text-[13.5px]">
                <tbody>
                  {doc.flags.map((f) => (
                    <tr key={f.flag} className="border-b border-line last:border-0">
                      <td className="w-[1%] bg-inset px-3 py-1.5 align-top font-mono text-[12.5px] whitespace-nowrap text-accent">{f.flag}</td>
                      <td className="px-3 py-1.5 text-fg-muted">
                        <Inline text={f.description} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {doc.examples.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">Examples</h4>
            <div className="space-y-3">
              {doc.examples.map((e, i) => (
                <div key={i}>
                  <p className="text-[13.5px] text-fg-muted">
                    <Inline text={e.description} />
                  </p>
                  <CodeBlock code={e.code} lang="bash" output={e.output} className="my-1.5" />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          {doc.useCases.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">Real-world uses</h4>
              <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-fg-muted marker:text-fg-subtle">
                {doc.useCases.map((u) => (
                  <li key={u}>
                    <Inline text={u} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {doc.mistakes.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">Common mistakes</h4>
              <ul className="space-y-1.5 text-[13.5px] text-fg-muted">
                {doc.mistakes.map((m) => (
                  <li key={m} className="flex gap-2">
                    <TriangleExclamationPoint size={13} className="mt-1 shrink-0 text-amber" />
                    <span>
                      <Inline text={m} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {(doc.portability || doc.related.length > 0) && (
          <div className="flex flex-col gap-3 border-t border-line pt-3 text-[13px] md:flex-row md:items-start">
            {doc.portability && (
              <p className="flex-1 text-fg-muted">
                <span className="font-medium text-blue">Portability: </span>
                <Inline text={doc.portability} />
              </p>
            )}
            {doc.related.length > 0 && (
              <p className="text-fg-subtle md:max-w-[45%]">
                Related:{" "}
                {doc.related.map((r, i) => (
                  <span key={r}>
                    {i > 0 && ", "}
                    <Link href={`/cheatsheets/commands#cmd-${r}`} className="font-mono text-fg-muted hover:text-accent">
                      {r}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
