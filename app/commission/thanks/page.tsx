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
      <p className="eyebrow">Received</p>
      <h1 className="mt-6 display-headline">
        Inquiry <em>received</em>.
      </h1>
      <p className="mt-8 text-lg text-muted">
        Thank you for sharing your project. I&apos;ll review the brief and
        reply with next steps within a couple of business days.
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
