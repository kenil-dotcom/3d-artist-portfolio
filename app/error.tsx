'use client';

/**
 * App-level error boundary.
 *
 * Next.js App Router routes render this when a server or client component
 * throws during rendering. Without it, an uncaught error returns an empty
 * HTTP 500 from Vercel which is hard to debug from the client side. With
 * it the visitor sees a reasonable fallback and a "Try again" affordance,
 * and we surface the digest hash so the corresponding entry in the
 * Vercel Functions log is easy to find.
 */

import { useEffect, type ReactElement } from 'react';

interface ErrorPageProps {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}

export default function ErrorPage({
  error,
  reset,
}: ErrorPageProps): ReactElement {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[app-error]', error.message, error.digest ?? '<no digest>');
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-4 px-6 py-16">
      <p className="eyebrow">Something went sideways</p>
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
        Hit a snag rendering this page.
      </h1>
      <p className="text-sm text-muted">
        Refresh and try again. If it keeps happening, the error reference
        below helps us track it down.
      </p>
      {error.digest !== undefined ? (
        <code className="rounded-md bg-surface px-2 py-1 text-xs text-muted">
          ref: {error.digest}
        </code>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="btn-primary mt-2"
      >
        Try again
      </button>
    </div>
  );
}
