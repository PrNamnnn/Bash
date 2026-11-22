import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-6 text-[12.5px] text-fg-subtle sm:flex-row sm:items-center sm:px-6">
        <p>
          Bash Mastery runs entirely in your browser. The terminal is a sandboxed simulator — it never touches your computer. Progress is stored locally on
          this device.
        </p>
        <nav aria-label="Footer" className="flex gap-4 sm:ml-auto">
          <Link href="/learn" className="hover:text-fg-muted">
            Curriculum
          </Link>
          <Link href="/cheatsheets" className="hover:text-fg-muted">
            Cheat sheets
          </Link>
          <Link href="/dashboard#data" className="hover:text-fg-muted">
            Your data
          </Link>
        </nav>
      </div>
    </footer>
  );
}
