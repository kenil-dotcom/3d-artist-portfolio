/**
 * Custom 404 page.
 *
 * Used for both unknown routes and unknown / unpublished project slugs (the
 * latter triggered by `notFound()` in `app/projects/[slug]/page.tsx`). The
 * copy avoids leaking whether the slug exists in draft form so the response
 * is byte-identical for "missing" and "draft" cases (Requirement 3.10).
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

export default function NotFound(): ReactElement {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-32 text-center">
      <span className="sticker animate-wiggle" style={{ background: 'hsl(var(--color-pop-honey))' }}>
        Oops · 404
      </span>
      <h1 className="mt-8 display-headline">
        This page <em>vanished</em>.
      </h1>
      <p className="mt-8 text-lg text-muted">
        The page or project you were looking for isn&apos;t available. It may
        have moved, been removed, or never existed.
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link href="/gallery" className="btn-primary" data-cursor-label="back">
          Back to Gallery
        </Link>
        <Link href="/" className="btn-secondary" data-cursor-label="home">
          Go home
        </Link>
      </div>
    </div>
  );
}
