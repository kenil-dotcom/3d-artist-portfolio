import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { CustomCursor } from '@/components/motion/CustomCursor';
import { getBio } from '@/lib/content/api';

import './globals.css';

/**
 * Display sans. Space Grotesk gives the headlines a chunky, geometric
 * personality without feeling techy. Loaded via next/font so it ships
 * with the bundle (no third-party CDN, no FOUT).
 */
const displaySans = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-display-sans',
});

/**
 * Root layout.
 *
 * Renders the site-wide chrome (skip link, header, footer) once for every
 * public page. The header and footer pull live data from `getBio` so the
 * artist name and social links stay in sync with the CMS.
 *
 * Layout uses semantic landmarks (`<header>`, `<main id="main-content">`,
 * `<footer>`) for assistive technologies (Requirement 10.5).
 */
export const metadata: Metadata = {
  title: '3D Artist Portfolio',
  description:
    'A portfolio of 3D renders, models, and animations by independent 3D artist Sid07.',
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const bio = await getBio();

  return (
    <html lang="en" className={displaySans.variable}>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-foreground focus:shadow-lg"
        >
          Skip to main content
        </a>
        <SiteHeader artistName={bio.artistName} />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <SiteFooter artistName={bio.artistName} socialLinks={bio.socialLinks} />
        <CustomCursor />
      </body>
    </html>
  );
}
