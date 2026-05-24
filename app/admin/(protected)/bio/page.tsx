/**
 * Bio editor.
 *
 * One page covering the singleton Bio row plus the related social links,
 * profile image, and resume PDF. Each upload sits in its own form so a
 * failed save on one doesn't lose work on the other.
 */

import type { ReactElement } from 'react';

import { BioForm } from '@/components/admin/BioForm';
import { BioImageUpload } from '@/components/admin/BioImageUpload';
import { BioResumeUpload } from '@/components/admin/BioResumeUpload';
import { requireAdmin } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Bio',
};

export default async function AdminBioPage(): Promise<ReactElement> {
  await requireAdmin();

  const row = await prisma.bio.findUnique({
    where: { id: 'singleton' },
    include: { socialLinks: { orderBy: { ordering: 'asc' } } },
  });

  const initial = {
    artistName: row?.artistName ?? '',
    tagline: row?.tagline ?? '',
    biography: row?.biography ?? '',
    skills: row?.skills ?? [],
    software: row?.software ?? [],
    socialLinks:
      row?.socialLinks.map((l) => ({
        platform: l.platform,
        url: l.url,
      })) ?? [],
    profileImageUrl: row?.profileImageStorageKey ?? null,
    resumeUrl: row?.resumeStorageKey ?? null,
  };

  return (
    <div className="space-y-10">
      <header>
        <span className="eyebrow">Bio</span>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
          Your <em className="not-italic text-[hsl(var(--color-pop-amber))]">story</em>.
        </h1>
        <p className="mt-2 text-sm text-muted">
          Updates here flow straight to the public landing and About page.
        </p>
      </header>

      <BioForm initial={initial} />

      <section
        aria-labelledby="profile-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-honey))]"
      >
        <h2
          id="profile-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Profile image
        </h2>
        <p className="mt-1 text-sm text-muted">
          JPEG, PNG, or WebP. Replaces the previous image immediately.
        </p>
        <div className="mt-4">
          <BioImageUpload currentUrl={initial.profileImageUrl} />
        </div>
      </section>

      <section
        aria-labelledby="resume-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-sage))]"
      >
        <h2
          id="resume-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Resume / CV
        </h2>
        <p className="mt-1 text-sm text-muted">
          PDF up to 20 MB. Linked from the About page when present.
        </p>
        <div className="mt-4">
          <BioResumeUpload currentUrl={initial.resumeUrl} />
        </div>
      </section>
    </div>
  );
}
