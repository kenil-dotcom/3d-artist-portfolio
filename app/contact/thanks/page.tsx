/**
 * Confirmation page shown after a successful contact-form submission.
 *
 * Spec reference: Requirement 6.3 — confirmation displayed within 2s of
 * successful persistence.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

export const metadata = {
  title: 'Message sent',
};

export default function ContactThanksPage(): ReactElement {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-32 text-center">
      <p className="eyebrow">Sent</p>
      <h1 className="mt-6 display-headline">
        Message <em>received</em>.
      </h1>
      <p className="mt-8 text-lg text-muted">
        Thank you for reaching out. I&apos;ll reply within a couple of business
        days. In the meantime, feel free to keep browsing the gallery.
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
