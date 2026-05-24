/**
 * Privacy policy.
 *
 * Static page enumerating the categories of data collected, the purposes
 * for which they are processed, retention periods, and the contact method
 * for privacy inquiries (Requirement 12.1).
 *
 * The legal copy here is a plain-English summary suitable for a personal
 * portfolio site; it should be reviewed by counsel before going to
 * production for a commercial business.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

export const metadata = {
  title: 'Privacy',
};

export default function PrivacyPage(): ReactElement {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.18em] text-accent">Privacy</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">
          Privacy policy
        </h1>
        <p className="mt-4 text-sm text-muted">Last updated: 2025-01-01</p>
      </header>

      <div className="prose-invert space-y-8 text-base leading-relaxed text-muted">
        <section aria-labelledby="overview-heading">
          <h2 id="overview-heading" className="text-xl font-semibold text-foreground">
            Overview
          </h2>
          <p className="mt-3">
            This site is a personal portfolio. It collects the minimum amount
            of personal data needed to show you the work, accept inquiries,
            and keep the site running. This page explains what is collected,
            why, how long it&apos;s kept, and how to contact us about it.
          </p>
        </section>

        <section aria-labelledby="data-categories-heading">
          <h2 id="data-categories-heading" className="text-xl font-semibold text-foreground">
            What we collect
          </h2>
          <ul className="mt-3 list-inside list-disc space-y-2">
            <li>
              <strong className="text-foreground">Inquiry submissions:</strong>{' '}
              your name, email address, message, and (for commission
              inquiries) project type, budget range, target deadline, and any
              reference images you upload.
            </li>
            <li>
              <strong className="text-foreground">Operational metadata:</strong>{' '}
              your truncated IP address (/24 for IPv4, /48 for IPv6) and
              browser user-agent, captured with each submission for spam
              prevention and audit purposes.
            </li>
            <li>
              <strong className="text-foreground">Cookies:</strong> a single
              first-party cookie records your consent decision and persists
              for 180 days. Non-essential analytics modules are loaded only
              after consent is given.
            </li>
            <li>
              <strong className="text-foreground">Server logs:</strong>{' '}
              standard request logs (path, status code, timestamp) retained
              for up to 30 days.
            </li>
          </ul>
        </section>

        <section aria-labelledby="purposes-heading">
          <h2 id="purposes-heading" className="text-xl font-semibold text-foreground">
            Why we use it
          </h2>
          <ul className="mt-3 list-inside list-disc space-y-2">
            <li>To respond to your contact and commission inquiries.</li>
            <li>To prevent spam and abuse of the inquiry forms.</li>
            <li>
              To audit privileged actions in the CMS (when applicable) for
              security purposes.
            </li>
            <li>
              To remember your cookie consent decision so we don&apos;t ask
              again on every page load.
            </li>
          </ul>
        </section>

        <section aria-labelledby="retention-heading">
          <h2 id="retention-heading" className="text-xl font-semibold text-foreground">
            How long we keep it
          </h2>
          <ul className="mt-3 list-inside list-disc space-y-2">
            <li>
              <strong className="text-foreground">Inquiry submissions</strong> are
              retained until you ask us to delete them, or for at most 24
              months after the last interaction, whichever is sooner.
              Deletion removes the inquiry row, attachments, and storage
              objects within 24 hours.
            </li>
            <li>
              <strong className="text-foreground">Operational metadata</strong> is
              kept for the same period as the inquiry it accompanies.
            </li>
            <li>
              <strong className="text-foreground">Consent cookies</strong> expire
              180 days after they&apos;re set.
            </li>
            <li>
              <strong className="text-foreground">Server logs</strong> are
              retained for at most 30 days.
            </li>
          </ul>
        </section>

        <section aria-labelledby="rights-heading">
          <h2 id="rights-heading" className="text-xl font-semibold text-foreground">
            Your rights
          </h2>
          <p className="mt-3">
            You can request access, correction, or deletion of any personal
            data we hold about you. To exercise these rights, send a request
            to the contact below from the email address used to submit your
            inquiry.
          </p>
        </section>

        <section aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="text-xl font-semibold text-foreground">
            Contact
          </h2>
          <p className="mt-3">
            For privacy questions or to request deletion, write to{' '}
            <a
              href="mailto:privacy@example.com"
              className="text-accent underline hover:opacity-80"
            >
              privacy@example.com
            </a>
            . You can also reach out via the{' '}
            <Link href="/contact" className="text-accent underline hover:opacity-80">
              contact form
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
