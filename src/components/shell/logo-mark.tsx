/** The Bash Mastery mark: a terminal prompt (>_). Same drawing as src/app/icon.svg. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="30" height="30" rx="7" fill="var(--color-surface-2)" stroke="var(--color-line-strong)" strokeWidth="2" />
      <path
        d="M9 10.5 14.5 16 9 21.5"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-transform duration-200 group-hover:translate-x-px"
      />
      <path d="M17 21.5h6" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
