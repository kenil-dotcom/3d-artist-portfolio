/**
 * Contact page.
 *
 * Shell for the client-side `<ContactForm />`. The page itself stays a
 * server component so route-level metadata (`metadata` export) and the
 * static layout copy can be statically rendered, while the form's input
 * state, fetch submission, and inline error display live on the client.
 *
 * Spec references:
 *   - Requirement 6.x — contact form fields and validation surface.
 */

import type { ReactElement } from 'react';

import { ContactForm } from '@/components/forms/ContactForm';

export const metadata = {
  title: 'Contact',
};

export default function ContactPage(): ReactElement {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <header className="mb-16">
        <span className="eyebrow">Contact</span>
        <h1 className="mt-4 display-headline">
          Say <em>hi</em>.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Got a question, a brief, or just want to nerd out about renders?
          Drop a note. I read everything.
        </p>
        <div className="luxe-rule mt-12" aria-hidden="true" />
      </header>

      <ContactForm />
    </div>
  );
}
