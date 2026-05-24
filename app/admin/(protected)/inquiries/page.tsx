/**
 * Inquiries inbox.
 *
 * Paginated table (25 per page) of every persisted inquiry. Filters by
 * type and status come through the URL search params so the page can
 * share links and reload state from history.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

import { requireAdmin } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Inquiries',
};

const PAGE_SIZE = 25;

interface SearchParams {
  readonly type?: string | string[];
  readonly status?: string | string[];
  readonly page?: string | string[];
}

interface InquiryRow {
  readonly id: string;
  readonly submittedAt: Date;
  readonly type: 'contact' | 'commission';
  readonly name: string;
  readonly email: string;
  readonly status: 'new' | 'read' | 'archived' | 'pending_deletion';
}

function pickFirst(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function parseTypeFilter(value: string | null): 'contact' | 'commission' | null {
  if (value === 'contact' || value === 'commission') return value;
  return null;
}

function parseStatusFilter(
  value: string | null,
): 'new' | 'read' | 'archived' | null {
  if (value === 'new' || value === 'read' || value === 'archived') {
    return value;
  }
  return null;
}

function buildLink(
  base: Record<string, string | null>,
  override: Record<string, string | null>,
): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...override };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null && value.length > 0) {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs.length === 0 ? '/admin/inquiries' : `/admin/inquiries?${qs}`;
}

export default async function InquiriesPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}): Promise<ReactElement> {
  await requireAdmin();

  const typeFilter = parseTypeFilter(pickFirst(searchParams.type));
  const statusFilter = parseStatusFilter(pickFirst(searchParams.status));
  const pageParam = pickFirst(searchParams.page);
  const requestedPage = pageParam === null ? 1 : Math.max(1, Number.parseInt(pageParam, 10) || 1);

  const where = {
    ...(typeFilter !== null ? { type: typeFilter } : {}),
    ...(statusFilter !== null ? { status: statusFilter } : {}),
  };

  const total = await prisma.inquiry.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * PAGE_SIZE;

  const rows = await prisma.inquiry.findMany({
    where,
    orderBy: { submittedAt: 'desc' },
    take: PAGE_SIZE,
    skip,
    select: {
      id: true,
      submittedAt: true,
      type: true,
      name: true,
      email: true,
      status: true,
    },
  });

  const inquiries: ReadonlyArray<InquiryRow> = rows.map((r) => ({
    id: r.id,
    submittedAt: r.submittedAt,
    type: r.type as InquiryRow['type'],
    name: r.name,
    email: r.email,
    status: r.status as InquiryRow['status'],
  }));

  const baseQuery: Record<string, string | null> = {
    type: typeFilter ?? null,
    status: statusFilter ?? null,
  };

  return (
    <div className="space-y-8">
      <header>
        <span className="eyebrow">Inquiries</span>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
          Inbox <em className="not-italic text-[hsl(var(--color-pop-amber))]">({total})</em>
        </h1>
      </header>

      <FilterBar
        type={typeFilter}
        status={statusFilter}
        baseQuery={baseQuery}
      />

      {inquiries.length === 0 ? (
        <div className="surface-card p-10 text-center">
          <p className="text-muted">No inquiries match these filters.</p>
        </div>
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b-2 border-foreground bg-surface text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">Submitted</th>
                  <th scope="col" className="px-4 py-3 text-left">Type</th>
                  <th scope="col" className="px-4 py-3 text-left">Name</th>
                  <th scope="col" className="px-4 py-3 text-left">Email</th>
                  <th scope="col" className="px-4 py-3 text-left">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">View</th>
                </tr>
              </thead>
              <tbody>
                {inquiries.map((row, i) => (
                  <tr
                    key={row.id}
                    className={
                      i % 2 === 0
                        ? 'border-t border-foreground/10'
                        : 'border-t border-foreground/10 bg-surface/40'
                    }
                  >
                    <td className="px-4 py-3 text-muted">
                      {row.submittedAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={row.type} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {row.name}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <span className="block max-w-[260px] truncate" title={row.email}>
                        {row.email}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/inquiries/${row.id}`}
                        className="btn-secondary px-4 py-1.5 text-xs"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          baseQuery={baseQuery}
        />
      ) : null}
    </div>
  );
}

function FilterBar({
  type,
  status,
  baseQuery,
}: {
  readonly type: string | null;
  readonly status: string | null;
  readonly baseQuery: Record<string, string | null>;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <FilterGroup label="Type" current={type ?? null} options={[
        { value: null, label: 'All' },
        { value: 'contact', label: 'Contact' },
        { value: 'commission', label: 'Commission' },
      ]} param="type" baseQuery={baseQuery} />
      <FilterGroup label="Status" current={status ?? null} options={[
        { value: null, label: 'All' },
        { value: 'new', label: 'New' },
        { value: 'read', label: 'Read' },
        { value: 'archived', label: 'Archived' },
      ]} param="status" baseQuery={baseQuery} />
    </div>
  );
}

function FilterGroup({
  label,
  current,
  options,
  param,
  baseQuery,
}: {
  readonly label: string;
  readonly current: string | null;
  readonly options: ReadonlyArray<{ readonly value: string | null; readonly label: string }>;
  readonly param: string;
  readonly baseQuery: Record<string, string | null>;
}): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
        {label}:
      </span>
      <div className="flex gap-1">
        {options.map((opt) => {
          const active = (current ?? null) === opt.value;
          return (
            <Link
              key={opt.label}
              href={buildLink(baseQuery, { [param]: opt.value, page: null })}
              className={`chip ${active ? 'chip-active' : ''}`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  baseQuery,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly baseQuery: Record<string, string | null>;
}): ReactElement {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between">
      <Link
        href={buildLink(baseQuery, { page: page > 1 ? String(page - 1) : null })}
        aria-disabled={page === 1}
        className={`btn-secondary px-4 py-2 text-xs ${
          page === 1 ? 'pointer-events-none opacity-40' : ''
        }`}
      >
        ← Previous
      </Link>
      <span className="text-sm text-muted">
        Page {page} of {totalPages}
      </span>
      <Link
        href={buildLink(baseQuery, {
          page: page < totalPages ? String(page + 1) : null,
        })}
        aria-disabled={page === totalPages}
        className={`btn-secondary px-4 py-2 text-xs ${
          page === totalPages ? 'pointer-events-none opacity-40' : ''
        }`}
      >
        Next →
      </Link>
    </nav>
  );
}

function TypeBadge({ type }: { readonly type: 'contact' | 'commission' }): ReactElement {
  if (type === 'commission') {
    return (
      <span className="sticker bg-[hsl(var(--color-pop-amber))]">Commission</span>
    );
  }
  return <span className="sticker bg-[hsl(var(--color-pop-honey))]">Contact</span>;
}

function StatusBadge({
  status,
}: {
  readonly status: 'new' | 'read' | 'archived' | 'pending_deletion';
}): ReactElement {
  if (status === 'new') {
    return (
      <span className="sticker bg-[hsl(var(--color-pop-honey))]">New</span>
    );
  }
  if (status === 'read') {
    return (
      <span className="sticker bg-[hsl(var(--color-pop-sage))]">Read</span>
    );
  }
  if (status === 'archived') {
    return <span className="sticker bg-surface">Archived</span>;
  }
  return <span className="sticker bg-[hsl(var(--color-pop-amber))]">Deleting</span>;
}
