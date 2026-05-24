/**
 * Admin projects index.
 *
 * Lists every project (published + draft) with cover thumbnail, title,
 * status, category, and a link into the editor. Sorted by `updatedAt`
 * descending so recent edits float to the top.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

import { requireAdmin } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Projects',
};

interface AdminProjectRow {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly status: 'draft' | 'published';
  readonly categoryName: string;
  readonly coverUrl: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

async function loadProjects(): Promise<ReadonlyArray<AdminProjectRow>> {
  const rows = await prisma.project.findMany({
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    include: {
      category: { select: { name: true } },
      coverMedia: { select: { storageKey: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status as 'draft' | 'published',
    categoryName: row.category.name,
    coverUrl: row.coverMedia?.storageKey ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function AdminProjectsPage(): Promise<ReactElement> {
  await requireAdmin();
  const projects = await loadProjects();

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Projects</span>
          <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-[-0.02em] md:text-5xl">
            All <em className="not-italic text-[hsl(var(--color-pop-amber))]">work</em>.
          </h1>
          <p className="mt-2 text-sm text-muted">
            {projects.length} project{projects.length === 1 ? '' : 's'} —
            drafts shown alongside published items.
          </p>
        </div>
        <Link href="/admin/projects/new" className="btn-primary">
          + New project
        </Link>
      </header>

      {projects.length === 0 ? (
        <div className="surface-card p-10 text-center">
          <p className="text-muted">
            No projects yet. Create the first one to get started.
          </p>
        </div>
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b-2 border-foreground bg-surface text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">Cover</th>
                  <th scope="col" className="px-4 py-3 text-left">Title</th>
                  <th scope="col" className="px-4 py-3 text-left">Status</th>
                  <th scope="col" className="px-4 py-3 text-left">Category</th>
                  <th scope="col" className="px-4 py-3 text-left">Created</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p, i) => (
                  <tr
                    key={p.id}
                    className={
                      i % 2 === 0
                        ? 'border-t border-foreground/10'
                        : 'border-t border-foreground/10 bg-surface/40'
                    }
                  >
                    <td className="px-4 py-3">
                      {p.coverUrl !== null ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.coverUrl}
                          alt=""
                          width={64}
                          height={48}
                          className="h-12 w-16 rounded-lg border-2 border-foreground object-cover"
                        />
                      ) : (
                        <div
                          aria-hidden="true"
                          className="h-12 w-16 rounded-lg border-2 border-foreground bg-surface"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{p.title}</p>
                      <p className="text-xs text-muted">/{p.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {p.categoryName}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {formatDate(p.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/projects/${p.id}/edit`}
                        className="btn-secondary px-4 py-2 text-xs"
                      >
                        Edit →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  readonly status: 'draft' | 'published';
}): ReactElement {
  if (status === 'published') {
    return (
      <span className="sticker bg-[hsl(var(--color-pop-sage))]">
        Published
      </span>
    );
  }
  return (
    <span className="sticker bg-[hsl(var(--color-pop-honey))]">Draft</span>
  );
}
