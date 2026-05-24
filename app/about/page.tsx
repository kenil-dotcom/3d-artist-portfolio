/**
 * About page.
 *
 * Renders the artist's profile image, biography, skills, software, social
 * links, and (optional) CV download link from the Bio singleton.
 *
 * Spec references:
 *   - Requirement 5.x — Bio page surfaces artist name, biography, skills,
 *     software, and social links.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

import { ResponsiveImage } from '@/components/media/ResponsiveImage';
import { Reveal } from '@/components/motion/Reveal';
import { getBio } from '@/lib/content/api';

export const dynamic = 'force-dynamic';

export default async function AboutPage(): Promise<ReactElement> {
  const bio = await getBio();
  const hasProfileImage =
    bio.profileImage !== null &&
    bio.profileImage.width !== null &&
    bio.profileImage.height !== null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-24">
      <Reveal as="header" className="mb-20 grid gap-16 md:grid-cols-[1fr_2fr] md:items-center">
        <div className="overflow-hidden rounded-3xl border-2 border-foreground bg-surface" style={{ boxShadow: '8px 8px 0 0 hsl(var(--color-pop-caramel))' }}>
          {hasProfileImage && bio.profileImage !== null ? (
            <ResponsiveImage
              src={bio.profileImage.storageKey}
              alt={`${bio.artistName || 'Artist'} portrait`}
              width={bio.profileImage.width ?? 800}
              height={bio.profileImage.height ?? 800}
              priority
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex aspect-square w-full items-center justify-center bg-gradient-to-br from-[hsl(var(--color-pop-honey))] to-[hsl(var(--color-pop-caramel))] font-[family-name:var(--font-display)] text-7xl font-bold text-foreground"
            >
              {(bio.artistName || '3D').slice(0, 2).toLowerCase()}
            </div>
          )}
        </div>
        <div>
          <span className="eyebrow">Hi, hello</span>
          <h1 className="mt-4 display-headline">
            I&apos;m <em>{bio.artistName || 'an artist'}</em>.
          </h1>
          {bio.tagline.trim().length > 0 ? (
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              {bio.tagline}
            </p>
          ) : null}
        </div>
      </Reveal>

      <Reveal as="section" aria-labelledby="biography-heading" className="mb-20">
        <div className="luxe-rule mb-10" aria-hidden="true" />
        <h2
          id="biography-heading"
          className="font-[family-name:var(--font-display)] text-3xl font-normal tracking-[-0.01em] md:text-4xl"
        >
          Biography.
        </h2>
        <p className="mt-6 max-w-3xl whitespace-pre-line text-lg leading-relaxed text-muted">
          {bio.biography.trim().length > 0
            ? bio.biography
            : 'Biography coming soon.'}
        </p>
      </Reveal>

      <Reveal
        as="section"
        aria-labelledby="skills-heading"
        className="mb-20 grid gap-16 md:grid-cols-2"
      >
        <div>
          <div className="luxe-rule mb-10" aria-hidden="true" />
          <h2
            id="skills-heading"
            className="font-[family-name:var(--font-display)] text-3xl font-normal tracking-[-0.01em] md:text-4xl"
          >
            Skills.
          </h2>
          {bio.skills.length === 0 ? (
            <p className="mt-6 text-sm text-muted">No skills listed.</p>
          ) : (
            <ul role="list" className="mt-6 flex flex-wrap gap-2">
              {bio.skills.map((skill) => (
                <li key={skill} className="chip">
                  {skill}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="luxe-rule mb-10" aria-hidden="true" />
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-normal tracking-[-0.01em] md:text-4xl">
            Software.
          </h2>
          {bio.software.length === 0 ? (
            <p className="mt-6 text-sm text-muted">No software listed.</p>
          ) : (
            <ul role="list" className="mt-6 flex flex-wrap gap-2">
              {bio.software.map((tool) => (
                <li key={tool} className="chip">
                  {tool}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Reveal>

      <Reveal as="section" aria-labelledby="connect-heading" className="mb-20">
        <div className="luxe-rule mb-10" aria-hidden="true" />
        <h2
          id="connect-heading"
          className="font-[family-name:var(--font-display)] text-3xl font-normal tracking-[-0.01em] md:text-4xl"
        >
          Connect.
        </h2>
        {bio.socialLinks.length === 0 ? (
          <p className="mt-6 text-sm text-muted">No social profiles yet.</p>
        ) : (
          <ul role="list" className="mt-6 flex flex-wrap gap-3">
            {bio.socialLinks.map((link) => (
              <li key={link.id as unknown as string}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                  data-cursor-label="visit"
                >
                  {link.platform} ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      {bio.resume !== null ? (
        <Reveal as="section" aria-labelledby="cv-heading">
          <div className="luxe-rule mb-10" aria-hidden="true" />
          <h2
            id="cv-heading"
            className="font-[family-name:var(--font-display)] text-3xl font-normal tracking-[-0.01em] md:text-4xl"
          >
            CV.
          </h2>
          <p className="mt-6">
            <a
              href={bio.resume.storageKey}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
              data-cursor-label="download"
            >
              Download CV (PDF)
            </a>
          </p>
        </Reveal>
      ) : null}

      <div className="mt-24 border-t border-border/70 pt-10 text-base text-muted">
        <p>
          Got a project in mind?{' '}
          <Link
            href="/commission"
            className="text-accent transition-colors duration-500 ease-soft hover:text-foreground"
          >
            Begin a commission
          </Link>{' '}
          or{' '}
          <Link
            href="/contact"
            className="text-accent transition-colors duration-500 ease-soft hover:text-foreground"
          >
            send a quick message
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
