/**
 * Inquiry detail view.
 *
 * Renders every persisted field of an inquiry plus reference image
 * thumbnails (commission only). Provides status change controls and a
 * delete button at the bottom.
 *
 * Marking an inquiry as `read` happens explicitly via the action bar;
 * we deliberately do NOT auto-mark on view so an admin can return to
 * "new" inquiries between sessions without losing their place.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { InquiryActions } from '@/components/admin/InquiryActions';
import { requireAdmin } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Inquiry',
};

const PROJECT_TYPE_LABELS: Readonly<Record<string, string>> = {
  Character: 'Character',
  Environment: 'Environment',
  ProductVisualization: 'Product Visualization',
  Animation: 'Animation',
  Other: 'Other',
};

interface PageProps {
  readonly params: { readonly id: string };
}

export default async function InquiryDetailPage({
  params,
}: PageProps): Promise<ReactElement> {
  await requireAdmin();

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: params.id },
    include: {
      referenceImages: { orderBy: { id: 'asc' } },
      budgetRange: { select: { label: true } },
    },
  });
  if (inquiry === null) {
    notFound();
  }

  const isCommission = inquiry.type === 'commission';
  const projectTypeLabel =
    inquiry.projectType !== null
      ? PROJECT_TYPE_LABELS[inquiry.projectType] ?? inquiry.projectType
      : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="eyebrow">
            {isCommission ? 'Commission' : 'Contact'} inquiry
          </span>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
            {inquiry.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Submitted{' '}
            {inquiry.submittedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
          </p>
        </div>
        <Link href="/admin/inquiries" className="btn-secondary px-4 py-2 text-xs">
          ← All inquiries
        </Link>
      </header>

      <section
        aria-labelledby="meta-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-honey))]"
      >
        <h2 id="meta-heading" className="sr-only">
          Inquiry details
        </h2>
        <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          <Field label="Status" value={inquiry.status} />
          <Field label="Type" value={inquiry.type} />
          <Field label="Name" value={inquiry.name} />
          <Field label="Email" value={inquiry.email} mono />
          {inquiry.subject !== null ? (
            <Field label="Subject" value={inquiry.subject} />
          ) : null}
          {isCommission ? (
            <>
              <Field
                label="Project type"
                value={projectTypeLabel ?? '—'}
              />
              <Field
                label="Budget range"
                value={inquiry.budgetRange?.label ?? '—'}
              />
              <Field
                label="Target deadline"
                value={
                  inquiry.targetDeadline === null
                    ? '—'
                    : inquiry.targetDeadline.toISOString().slice(0, 10)
                }
              />
            </>
          ) : null}
          <Field label="Client IP" value={inquiry.clientIp} mono />
          {inquiry.userAgent !== null ? (
            <Field label="User agent" value={inquiry.userAgent} mono />
          ) : null}
          {inquiry.deliveryFailed ? (
            <div className="md:col-span-2">
              <p
                role="alert"
                className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.3)] px-4 py-3 text-sm font-medium text-foreground"
              >
                Notification email failed to deliver after retries.
              </p>
            </div>
          ) : null}
        </dl>
      </section>

      <section
        aria-labelledby="message-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-sage))]"
      >
        <h2
          id="message-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Message
        </h2>
        <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
          {inquiry.message}
        </p>
      </section>

      {isCommission ? (
        <section
          aria-labelledby="refs-heading"
          className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-caramel))]"
        >
          <h2
            id="refs-heading"
            className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
          >
            Reference images
          </h2>
          {inquiry.referenceImages.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              No reference images submitted.
            </p>
          ) : (
            <ul
              role="list"
              className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3"
            >
              {inquiry.referenceImages.map((img) => (
                <li key={img.id}>
                  <a
                    href={img.storageKey}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-2xl border-2 border-foreground bg-background"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.storageKey}
                      alt={img.originalFilename}
                      className="aspect-[4/3] w-full object-cover"
                    />
                    <p className="px-3 py-2 text-xs text-muted">
                      {img.originalFilename}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section
        aria-labelledby="actions-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-amber))]"
      >
        <h2
          id="actions-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Actions
        </h2>
        <p className="mt-1 text-sm text-muted">
          Status changes are immediate. Deletion is permanent and cascades
          through any reference images.
        </p>
        <div className="mt-4">
          <InquiryActions
            id={inquiry.id}
            status={inquiry.status as 'new' | 'read' | 'archived' | 'pending_deletion'}
          />
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): ReactElement {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm text-foreground ${mono === true ? 'font-mono' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
