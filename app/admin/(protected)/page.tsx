/**
 * Admin dashboard.
 *
 * At-a-glance stats for the artist:
 *   - Published / draft project counts
 *   - Total / unread inquiry counts
 *
 * Plus quick links to the most common entry points (new project,
 * edit bio, inquiries inbox).
 *
 * Counts come from Prisma directly; we deliberately avoid going
 * through the public content API because it filters drafts.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

import { requireAdmin } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Dashboard',
};

interface DashboardStats {
  readonly publishedProjects: number;
  readonly draftProjects: number;
  readonly totalInquiries: number;
  readonly newInquiries: number;
}

async function loadStats(): Promise<DashboardStats> {
  const [publishedProjects, draftProjects, totalInquiries, newInquiries] =
    await Promise.all([
      prisma.project.count({ where: { status: 'published' } }),
      prisma.project.count({ where: { status: 'draft' } }),
      prisma.inquiry.count(),
      prisma.inquiry.count({ where: { status: 'new' } }),
    ]);

  return { publishedProjects, draftProjects, totalInquiries, newInquiries };
}

export default async function AdminDashboardPage(): Promise<ReactElement> {
  const session = await requireAdmin();
  const stats = await loadStats();

  return (
    <div className="space-y-12">
      <header>
        <span className="eyebrow">Dashboard</span>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-[-0.02em] md:text-5xl">
          Welcome back,{' '}
          <em className="not-italic text-[hsl(var(--color-pop-amber))]">
            {session.admin.username}
          </em>
          .
        </h1>
        <p className="mt-3 max-w-xl text-base text-muted">
          Quick overview of the portfolio. Use the sidebar to manage projects,
          bio, the featured set, and inquiries.
        </p>
      </header>

      <section aria-label="Stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Published projects"
          value={stats.publishedProjects}
          accent="honey"
        />
        <StatCard
          label="Drafts"
          value={stats.draftProjects}
          accent="caramel"
        />
        <StatCard
          label="Total inquiries"
          value={stats.totalInquiries}
          accent="sage"
        />
        <StatCard
          label="Unread inquiries"
          value={stats.newInquiries}
          accent="amber"
        />
      </section>

      <section aria-label="Quick actions">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]">
          Jump in
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/admin/projects/new" className="btn-primary">
            + New project
          </Link>
          <Link href="/admin/bio" className="btn-secondary">
            Edit bio
          </Link>
          <Link href="/admin/inquiries" className="btn-secondary">
            View inquiries
          </Link>
          <Link href="/admin/featured" className="btn-secondary">
            Featured set
          </Link>
        </div>
      </section>
    </div>
  );
}

interface StatCardProps {
  readonly label: string;
  readonly value: number;
  readonly accent: 'honey' | 'caramel' | 'sage' | 'amber';
}

const ACCENT_SHADOW: Record<StatCardProps['accent'], string> = {
  honey: '6px 6px 0 0 hsl(var(--color-pop-honey))',
  caramel: '6px 6px 0 0 hsl(var(--color-pop-caramel))',
  sage: '6px 6px 0 0 hsl(var(--color-pop-sage))',
  amber: '6px 6px 0 0 hsl(var(--color-pop-amber))',
};

function StatCard({ label, value, accent }: StatCardProps): ReactElement {
  return (
    <div
      className="surface-card p-5"
      style={{ boxShadow: ACCENT_SHADOW[accent] }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        {label}
      </p>
      <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-[-0.02em]">
        {value}
      </p>
    </div>
  );
}
