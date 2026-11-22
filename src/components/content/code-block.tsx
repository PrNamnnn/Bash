import { highlight, tokClass } from "@/lib/highlight";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/cn";

const LANG_LABEL: Record<string, string> = {
  bash: "bash",
  sh: "sh",
  console: "terminal",
  text: "text",
  yaml: "yaml",
  yml: "yaml",
  ini: "ini",
  conf: "config",
  crontab: "crontab",
  dockerfile: "Dockerfile",
  json: "json",
  diff: "diff",
};

export function HighlightedLines({ code, lang, numbered }: { code: string; lang: string; numbered?: boolean }) {
  const lines = highlight(code, lang);
  return (
    <>
      {lines.map((toks, i) => (
        <div key={i} className="flex" style={{ minHeight: "1.6em" }}>
          {numbered && <span className="mr-4 w-5 shrink-0 text-right text-fg-subtle/70 select-none">{i + 1}</span>}
          <span>
            {lang === "diff" ? (
              <span className={toks[0]?.v.startsWith("+") ? "text-accent" : toks[0]?.v.startsWith("-") ? "text-red" : toks[0]?.v.startsWith("@@") ? "text-violet" : "text-fg-muted"}>{toks.map((t) => t.v).join("")}</span>
            ) : (
              toks.map((t, j) => (
                <span key={j} className={tokClass[t.t]}>
                  {t.v}
                </span>
              ))
            )}
          </span>
        </div>
      ))}
    </>
  );
}

/** Server-rendered, syntax-highlighted code block (no client JS except the copy button). */
export function CodeBlock({ code, lang = "bash", title, output, className }: { code: string; lang?: string; title?: string; output?: string; className?: string }) {
  const numbered = code.split("\n").length > 4 && (lang === "bash" || lang === "sh");
  return (
    <div className={cn("group my-5 overflow-hidden rounded-lg border border-line bg-inset", className)}>
      <div className="flex h-8 items-center gap-2 border-b border-line bg-surface px-3">
        <span className="font-mono text-[11.5px] text-fg-subtle">{title ?? LANG_LABEL[lang] ?? lang}</span>
        <CopyButton text={lang === "console" ? code.split("\n").filter((l) => /^\$ /.test(l)).map((l) => l.slice(2)).join("\n") : code} className="ml-auto" />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-[1.6]">
        <HighlightedLines code={code} lang={lang} numbered={numbered} />
      </pre>
      {output !== undefined && (
        <div className="border-t border-line">
          <div className="px-4 pt-2 text-[10.5px] font-medium tracking-wide text-fg-subtle uppercase">Output</div>
          <pre className="overflow-x-auto px-4 pt-1 pb-3 font-mono text-[12.5px] leading-[1.6] whitespace-pre text-fg-muted">{output}</pre>
        </div>
      )}
    </div>
  );
}
