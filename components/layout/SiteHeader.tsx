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
      className="sticky top-0 z-30 border-b transition-[background-color,border-color,backdrop-filter] duration-700 ease-soft data-[scrolled=false]:border-transparent data-[scrolled=false]:bg-background/0 data-[scrolled=false]:supports-[backdrop-filter]:bg-background/0 data-[scrolled=true]:border-border/70 data-[scrolled=true]:bg-background/85 data-[scrolled=true]:backdrop-blur supports-[backdrop-filter]:data-[scrolled=true]:bg-background/70"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-lg italic text-foreground transition-colors duration-500 ease-soft hover:text-accent"
        >
          {displayName}
        </Link>
        <nav aria-label="Primary">
          <ul className="flex items-center gap-1 text-xs uppercase tracking-[0.2em] md:gap-3">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-none px-3 py-2 text-foreground/70 transition-colors duration-500 ease-soft hover:text-foreground"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/commission"
                className="btn-primary ml-3"
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
