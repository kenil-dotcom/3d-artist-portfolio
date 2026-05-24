'use client';

/**
 * Last-resort error boundary.
 *
 * Catches errors that escape the root layout itself (e.g. an exception
 * thrown by a server component before the body even mounts). When this
 * fires, the standard `app/error.tsx` cannot render because there is no
 * surrounding `<html>` / `<body>` yet, so we ship our own document shell.
 *
 * Keep this minimal: no fonts, no imports from `lib/*`, no dependencies
 * that could themselves throw. The whole point is to render *something*
 * when nothing else is working.
 */

import { useEffect, type ReactElement } from 'react';

interface GlobalErrorProps {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}

export default function GlobalError({
  error,
  reset,
}: GlobalErrorProps): ReactElement {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global-error]', error.message, error.digest ?? '<no digest>');
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1a1a1a',
          color: '#f5f1e8',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <p
            style={{
              fontSize: '0.75rem',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              opacity: 0.6,
            }}
          >
            Critical error
          </p>
          <h1
            style={{
              fontSize: '2rem',
              marginTop: '1rem',
              marginBottom: '1rem',
              lineHeight: 1.1,
            }}
          >
            The site failed to render.
          </h1>
          <p style={{ opacity: 0.8, marginBottom: '1.5rem' }}>
            Refresh the page. If it keeps happening, send the reference
            below so it can be tracked down.
          </p>
          {error.digest !== undefined ? (
            <code
              style={{
                display: 'inline-block',
                background: 'rgba(255,255,255,0.08)',
                padding: '0.25rem 0.5rem',
                borderRadius: 4,
                fontSize: '0.75rem',
                marginBottom: '1.5rem',
              }}
            >
              ref: {error.digest}
            </code>
          ) : null}
          <div>
            <button
              type="button"
              onClick={reset}
              style={{
                background: '#f5b941',
                color: '#1a1a1a',
                border: '2px solid #1a1a1a',
                padding: '0.6rem 1.2rem',
                borderRadius: 9999,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
