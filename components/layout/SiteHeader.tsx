'use client';

/**
 * Site-wide header rendered on every public page.
 *
 * The header is a client component so it can listen for scroll position
 * and intensify its frosted-glass effect (heavier blur, stronger border)
 * once the visitor has scrolled past the hero. This is the same trick
 * Apple uses on apple.com — the navigation chrome is invisible at the
 * top of the page and gradually picks up presence as the page scrolls.
 *
 * Wraps the brand mark and primary navigation in semantic `<header>` and
 * `<nav>` landmarks (Requirement 10.5 — semantic structure). The "Hire me"
 * call-to-action is highlighted as a primary action.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';

interface SiteHeaderProps {
  readonly artistName: string;
}

const NAV_LINKS = [
  { href: '/gallery', label: 'Gallery' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const;

export function SiteHeader({ artistName }: SiteHeaderProps): ReactElement {
  const displayName = artistName.trim().length > 0 ? artistName : '3D Portfolio';
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (): void => {
      setScrolled(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      data-scrolled={scrolled ? 'true' : 'false'}
      className="sticky top-0 z-30 transition-[background-color,border-color,backdrop-filter] duration-500 ease-soft data-[scrolled=false]:border-b-2 data-[scrolled=false]:border-transparent data-[scrolled=false]:bg-background/0 data-[scrolled=true]:border-b-2 data-[scrolled=true]:border-foreground data-[scrolled=true]:bg-background/85 data-[scrolled=true]:backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-xl font-bold tracking-[-0.03em] text-foreground"
        >
          {displayName}
          <span className="ml-0.5 text-[hsl(var(--color-pop-amber))]">.</span>
        </Link>
        <nav aria-label="Primary">
          <ul className="flex items-center gap-1 text-sm font-semibold md:gap-3">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-full px-4 py-2 text-foreground/80 transition-colors duration-300 ease-pop hover:bg-foreground hover:text-background"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/commission"
                className="btn-primary ml-2"
                data-cursor-label="let's talk"
              >
                Hire me
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

export default SiteHeader;
