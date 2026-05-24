/**
 * Site-wide footer rendered on every public page.
 *
 * Surfaces the copyright line, a privacy link (Requirement 12.1 — privacy
 * notice accessible from any page), and the artist's external profile
 * links. External links open with `rel="noopener noreferrer"`.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

import type { SocialLink } from '@/lib/types/domain';

interface SiteFooterProps {
  readonly artistName: string;
  readonly socialLinks: ReadonlyArray<SocialLink>;
}

export function SiteFooter({
  artistName,
  socialLinks,
}: SiteFooterProps): ReactElement {
  const displayName =
    artistName.trim().length > 0 ? artistName : '3D Artist Portfolio';
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/70 bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 text-xs uppercase tracking-[0.18em] text-muted md:flex-row md:items-center md:justify-between">
        <p className="normal-case tracking-normal">
          &copy; {year} {displayName}. All work shown for portfolio purposes.
        </p>
        <ul className="flex flex-wrap items-center gap-6">
          <li>
            <Link href="/contact" className="hover:text-foreground">
              Contact
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
          </li>
          {socialLinks.map((link) => (
            <li key={link.id as unknown as string}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                {link.platform}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}

export default SiteFooter;
