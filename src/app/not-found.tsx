import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-mono text-[13px] text-red">bash: cd: this-page: No such file or directory</p>
      <h1 className="mt-4 text-[28px] font-semibold text-fg">Page not found</h1>
      <p className="mt-2 text-[15px] text-fg-muted">The page you asked for doesn&apos;t exist (exit status 127, if you like).</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/learn" className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-fg hover:bg-accent-strong">
          Browse the curriculum
        </Link>
        <Link href="/" className="rounded-md border border-line px-4 py-2 text-[14px] text-fg-muted hover:text-fg">
          Home
        </Link>
      </div>
    </div>
  );
}
