/**
 * Create a new project.
 *
 * Minimal form covering the fields required to create the row. After
 * save, the user is redirected to `/admin/projects/[id]/edit` where
 * they can fill in tags, software, media, and switch the status to
 * published.
 */

import type { ReactElement } from 'react';

import { NewProjectForm } from '@/components/admin/NewProjectForm';
import { requireAdmin } from '@/lib/auth/middleware';
import { listCategories } from '@/lib/content/api';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · New project',
};

export default async function NewProjectPage(): Promise<ReactElement> {
  await requireAdmin();
  const categories = await listCategories();

  return (
    <div className="space-y-8">
      <header>
        <span className="eyebrow">New project</span>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
          Start a <em className="not-italic text-[hsl(var(--color-pop-amber))]">new piece</em>.
        </h1>
        <p className="mt-2 text-sm text-muted">
          Save the basics, then upload media and publish from the editor.
        </p>
      </header>

      <NewProjectForm
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
