/**
 * Confirmation page shown after a successful commission inquiry.
 *
 * Spec reference: Requirement 7.4 — confirmation message indicating the
 * inquiry was received.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

export const metadata = {
  title: 'Inquiry received',
};

export default function CommissionThanksPage(): ReactElement {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-32 text-center">
      <span className="sticker animate-wiggle" style={{ background: 'hsl(var(--color-pop-honey))' }}>
        Brief received ✿
      </span>
      <h1 className="mt-8 display-headline">
        Let&apos;s do <em>this</em>.
      </h1>
      <p className="mt-8 text-lg text-muted">
        Your brief is in my inbox. I&apos;ll review it and come back within a
        couple of business days with thoughts, questions, and a rough plan.
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link href="/gallery" className="btn-primary">
          Back to Gallery
        </Link>
        <Link href="/" className="btn-secondary">
          Go home
        </Link>
      </div>
    </div>
  );
}
