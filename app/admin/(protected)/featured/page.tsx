/**
 * Featured set editor.
 *
 * Lists every published project with a checkbox + numeric order field.
 * The 0..11 range is enforced both by the input attributes and by the
 * `validateFeaturedIds` server-side check.
 */

import type { ReactElement } from 'react';

import { FeaturedForm } from '@/components/admin/FeaturedForm';
import { requireAdmin } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Featured set',
};

export default async function AdminFeaturedPage(): Promise<ReactElement> {
  await requireAdmin();

  const rows = await prisma.project.findMany({
    where: { status: 'published' },
    orderBy: [
      { featuredOrder: { sort: 'asc', nulls: 'last' } },
      { publishedAt: 'desc' },
    ],
    select: {
      id: true,
      title: true,
      slug: true,
      featuredOrder: true,
    },
  });

  const projects = rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    currentOrder: r.featuredOrder,
  }));

  return (
    <div className="space-y-8">
      <header>
        <span className="eyebrow">Featured set</span>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
          Pick the <em className="not-italic text-[hsl(var(--color-pop-amber))]">highlights</em>.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Up to 12 published projects appear on the landing page in the
          order you set here. Lower numbers come first. Unchecked projects
          fall back to the most-recent rule.
        </p>
      </header>

      <FeaturedForm projects={projects} />
    </div>
  );
}
