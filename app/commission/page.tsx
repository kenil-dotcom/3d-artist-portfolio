/**
 * Commission inquiry page.
 *
 * Shell for the client-side `<CommissionForm />`. Static metadata + layout
 * copy stays server-rendered; the form (state, fetch submission, inline
 * errors, future-only date picker) lives on the client.
 *
 * Spec references:
 *   - Requirement 7.x — commission form fields and validation surface.
 */

import type { ReactElement } from 'react';

import { CommissionForm } from '@/components/forms/CommissionForm';

export const metadata = {
  title: 'Commission',
};

export default function CommissionPage(): ReactElement {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <header className="mb-16">
        <p className="eyebrow">Commission</p>
        <h1 className="mt-4 display-headline">
          Begin a <em>commission</em>.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Share a few details about your project and I&apos;ll respond within
          two business days.
        </p>
        <div className="luxe-rule mt-12" aria-hidden="true" />
      </header>

      <CommissionForm />
    </div>
  );
}
