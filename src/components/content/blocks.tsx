import type { Block, CalloutVariant } from "@/types/content";
import { Inline } from "./inline";
import { CodeBlock, HighlightedLines } from "./code-block";
import { CommandCard } from "./command-card";
import { RunnableCode } from "./runnable-code";
import { Exercise } from "@/components/exercises/exercise";
import { Viz } from "@/components/viz/viz";
import { LazyTerminal } from "@/components/terminal/lazy-terminal";
import { Deferred } from "@/components/ui/deferred";
import { getCommand } from "@/lib/content/commands";
import { Info, Lightbulb, TriangleExclamationPoint, OctagonAlert, Globe, X, Check } from "lucide-react";
import { cn } from "@/lib/cn";

const CALLOUT: Record<CalloutVariant, { cls: string; icon: typeof Info; label: string }> = {
  note: { cls: "border-blue/40 bg-blue-dim/30", icon: Info, label: "Note" },
  tip: { cls: "border-accent/40 bg-accent-dim/25", icon: Lightbulb, label: "Tip" },
  warning: { cls: "border-amber/40 bg-amber-dim/30", icon: TriangleExclamationPoint, label: "Warning" },
  danger: { cls: "border-red/45 bg-red-dim/35", icon: OctagonAlert, label: "Danger" },
  portability: { cls: "border-violet/40 bg-violet-dim/25", icon: Globe, label: "Portability" },
};
const ICON_COLOR: Record<CalloutVariant, string> = { note: "text-blue", tip: "text-accent", warning: "text-amber", danger: "text-red", portability: "text-violet" };

export function Blocks({ blocks, context }: { blocks: Block[]; context: string }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} context={context} />
      ))}
    </>
  );
}

function BlockView({ block: b, context }: { block: Block; context: string }) {
  switch (b.type) {
    case "paragraph":
      return (
        <p className="my-4">
          <Inline text={b.text} />
        </p>
      );
    case "heading": {
      const H = b.level === 3 ? "h3" : "h4";
      return (
        <H id={b.id} className={cn("scroll-mt-24 font-semibold tracking-tight text-fg", b.level === 3 ? "mt-8 mb-2 text-[17px]" : "mt-6 mb-2 text-[15px]")}>
          <Inline text={b.text} />
        </H>
      );
    }
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return (
        <L className={cn("my-4 space-y-1.5 pl-6", b.ordered ? "list-decimal marker:text-fg-subtle" : "list-disc marker:text-fg-subtle")}>
          {b.items.map((it, i) => (
            <li key={i} className="pl-1">
              <Inline text={it} />
            </li>
          ))}
        </L>
      );
    }
    case "code":
      if (b.playground) {
        return (
          <RunnableCode code={b.code} title={b.title} notes={b.notes}>
            <HighlightedLines code={b.code} lang={b.lang} numbered={b.code.split("\n").length > 4} />
          </RunnableCode>
        );
      }
      return <CodeBlock code={b.code} lang={b.lang} title={b.title} output={b.output} />;
    case "callout": {
      const c = CALLOUT[b.variant];
      const Icon = c.icon;
      return (
        <aside className={cn("my-5 rounded-lg border px-4 py-3", c.cls)} aria-label={b.title ?? c.label}>
          <p className={cn("mb-1 flex items-center gap-2 text-[13px] font-semibold", ICON_COLOR[b.variant])}>
            <Icon size={15} /> {b.title ?? c.label}
          </p>
          <div className="text-[14.5px] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2">
            <Blocks blocks={b.blocks} context={context} />
          </div>
        </aside>
      );
    }
    case "table":
      return (
        <div className="my-5 overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-[14px]">
            <thead className="bg-surface-2">
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} className="border-b border-line px-3 py-2 text-left text-[12.5px] font-semibold text-fg">
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-b border-line/70 last:border-0">
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2 align-top text-fg-muted">
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "viz":
      return (
        <Deferred minHeight={320} label="Loading visualization">
          <Viz id={b.id} />
        </Deferred>
      );
    case "command":
      return (
        <>
          {b.names.map((n) => {
            const doc = getCommand(n);
            if (!doc) throw new Error(`[content] unknown command reference ::command ${n} in ${context}`);
            return <CommandCard key={n} doc={doc} />;
          })}
        </>
      );
    case "terminal":
      return (
        <div className="my-6">
          <Deferred minHeight={380} label="Loading terminal">
            <LazyTerminal fixture={b.fixture} suggestions={b.suggestions} height="260px" welcome={false} />
          </Deferred>
          <p className="mt-1.5 text-[12px] text-fg-subtle">Sandboxed Bash simulator — experiment freely; <code className="inline-code">reset</code> restores the files.</p>
        </div>
      );
    case "exercise":
      return <Exercise exercise={b.exercise} context={context} />;
    case "mistake":
      return (
        <div className="my-5 overflow-hidden rounded-lg border border-line">
          <p className="border-b border-line bg-surface-2/70 px-4 py-2 text-[13.5px] font-semibold text-fg">
            <Inline text={b.mistake.title} />
          </p>
          <div className="grid md:grid-cols-2">
            <div className="border-b border-line md:border-r md:border-b-0">
              <p className="flex items-center gap-1.5 px-4 pt-2 text-[11px] font-semibold tracking-wide text-red uppercase">
                <X size={12} /> Wrong
              </p>
              <pre className="overflow-x-auto px-4 pt-1 pb-3 font-mono text-[12.5px] leading-[1.6]">
                <HighlightedLines code={b.mistake.wrong} lang="bash" />
              </pre>
            </div>
            <div>
              <p className="flex items-center gap-1.5 px-4 pt-2 text-[11px] font-semibold tracking-wide text-accent uppercase">
                <Check size={12} /> Right
              </p>
              <pre className="overflow-x-auto px-4 pt-1 pb-3 font-mono text-[12.5px] leading-[1.6]">
                <HighlightedLines code={b.mistake.right} lang="bash" />
              </pre>
            </div>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-[13.5px] text-fg-muted">
            <Inline text={b.mistake.why} />
          </p>
        </div>
      );
    case "compare":
      return (
        <div className={cn("my-5 grid gap-3", b.items.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
          {b.items.map((it) => (
            <div key={it.label} className="overflow-hidden rounded-lg border border-line bg-inset">
              <p className="border-b border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-fg-muted">
                <Inline text={it.label} />
              </p>
              <pre className="overflow-x-auto px-3 py-2 font-mono text-[12.5px] leading-[1.6]">
                <HighlightedLines code={it.code} lang="bash" />
              </pre>
              {it.note && (
                <p className="border-t border-line px-3 py-2 text-[13px] text-fg-muted">
                  <Inline text={it.note} />
                </p>
              )}
            </div>
          ))}
        </div>
      );
  }
}
