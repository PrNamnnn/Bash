import Link from "next/link";
import { NavLinks } from "./nav-links";
import { LogoMark } from "./logo-mark";
import { MobileNav } from "./mobile-nav";
import { SearchButton } from "@/components/search/search-button";
import { HeaderProgress } from "@/components/progress/header-progress";
import { allLessons } from "@/lib/curriculum";

export function Logo() {
  return (
    <Link href="/" className="group flex shrink-0 items-center gap-2.5 rounded-md" aria-label="Bash Mastery home">
      <LogoMark size={28} />
      <span className="text-[15px] font-semibold tracking-tight text-fg">
        Bash<span className="text-fg-subtle">/</span>Mastery
      </span>
    </Link>
  );
}

export function SiteHeader() {
  const slugs = allLessons().map((l) => l.slug);
  return (
    <header className="sticky top-0 z-40 h-[var(--header-h)] border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <MobileNav />
        <Logo />
        <NavLinks />
        <div className="ml-auto flex items-center gap-2">
          <SearchButton />
          <HeaderProgress slugs={slugs} />
        </div>
      </div>
    </header>
  );
}
