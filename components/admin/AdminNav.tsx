'use client';

/**
 * Admin sidebar navigation.
 *
 * Highlights the active section using `usePathname`. Renders as a
 * vertical rail on `lg` and a horizontal scroller on smaller viewports
 * so the layout collapses gracefully on tablet and phone.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';

interface NavLink {
  readonly href: string;
  readonly label: string;
}

const NAV_LINKS: ReadonlyArray<NavLink> = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/projects', label: 'Projects' },
  { href: '/admin/featured', label: 'Featured' },
  { href: '/admin/bio', label: 'Bio' },
  { href: '/admin/inquiries', label: 'Inquiries' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') {
    return pathname === '/admin';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav(): ReactElement {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin sections"
      className="lg:w-56 lg:shrink-0"
    >
      <ul
        role="list"
        className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0"
      >
        {NAV_LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`block whitespace-nowrap rounded-2xl border-2 px-4 py-2.5 text-sm font-semibold transition-colors duration-200 ease-pop ${
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-foreground/10 bg-background text-foreground hover:border-foreground hover:bg-[hsl(var(--color-pop-honey)/0.4)]'
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
