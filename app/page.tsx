/**
 * Landing page.
 *
 * Renders the artist's name + tagline, a hero call-to-action, and a
 * featured-projects grid. Featured selection is computed by the pure
 * `selectLandingFeatured` reducer via `listFeaturedProjects`:
 *   - admin-curated set when sized 3..8 (Req 1.3),
 *   - 6 most recent published projects as fallback (Req 1.6/1.7),
 *   - empty-state placeholder when no published projects exist (Req 1.8).
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

import { ResponsiveImage } from '@/components/media/ResponsiveImage';
import { Reveal } from '@/components/motion/Reveal';
import { getBio, listFeaturedProjects } from '@/lib/content/api';
import type { Project } from '@/lib/types/domain';

export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<ReactElement> {
  const [bio, featured] = await Promise.all([getBio(), listFeaturedProjects()]);

  return (
    <div>
      <Hero artistName={bio.artistName} tagline={bio.tagline} />

      <section
        className="mx-auto max-w-6xl px-6 pb-32"
        aria-labelledby="featured-heading"
      >
        <Reveal className="mb-12 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Selected work</p>
            <h2
              id="featured-heading"
              className="mt-4 font-[family-name:var(--font-display)] text-4xl font-normal tracking-[-0.01em] md:text-6xl"
            >
              Featured <em className="italic text-accent">projects</em>.
            </h2>
            <p className="mt-3 max-w-xl text-base text-muted">
              A rotating selection. The full archive lives in the gallery.
            </p>
          </div>
          <Link
            href="/gallery"
            className="text-xs uppercase tracking-[0.2em] text-accent transition-colors duration-500 ease-soft hover:text-foreground"
            data-cursor-label="see all"
          >
            View archive →
          </Link>
        </Reveal>

        {featured.length === 0 ? (
          <Reveal>
            <p className="rounded-2xl border border-border bg-surface px-6 py-14 text-center text-muted">
              Featured work is not yet available. Check back soon.
            </p>
          </Reveal>
        ) : (
          <ul
            role="list"
            aria-label="Featured projects"
            className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
          >
            {featured.map((project, index) => (
              <Reveal
                key={project.id as unknown as string}
                as="li"
                delay={120 + index * 90}
              >
                <FeaturedTile project={project} priority={index < 3} />
              </Reveal>
            ))}
          </ul>
        )}
      </section>

      <AboutTeaser biography={bio.biography} />
    </div>
  );
}

interface HeroProps {
  readonly artistName: string;
  readonly tagline: string;
}

function Hero({ artistName, tagline }: HeroProps): ReactElement {
  const name = artistName.trim().length > 0 ? artistName : 'Independent 3D Artist';
  const headline =
    tagline.trim().length > 0
      ? tagline
      : 'Worlds, characters, and product stories rendered in 3D.';
  return (
    <section className="relative isolate mx-auto max-w-6xl px-6 pb-32 pt-32 md:pt-44">
      <div className="hero-halo" aria-hidden="true" />

      <Reveal className="eyebrow">
        Studio of Sid07 — 3D &amp; Image Making
      </Reveal>

      <Reveal delay={140}>
        <h1 className="mt-8 display-headline">
          {name}.<br />
          <em>Crafted in light.</em>
        </h1>
      </Reveal>

      <Reveal delay={280}>
        <p className="mt-10 max-w-xl text-lg leading-relaxed text-muted md:text-xl md:leading-relaxed">
          {headline}
        </p>
      </Reveal>

      <Reveal delay={420} className="mt-12 flex flex-wrap gap-4">
        <Link
          href="/gallery"
          className="btn-primary"
          data-cursor-label="enter"
        >
          Enter the gallery
        </Link>
        <Link
          href="/commission"
          className="btn-secondary"
          data-cursor-label="say hello"
        >
          Begin a commission
        </Link>
      </Reveal>

      <Reveal delay={560} className="mt-24">
        <div className="luxe-rule" aria-hidden="true" />
      </Reveal>
    </section>
  );
}

interface FeaturedTileProps {
  readonly project: Project;
  readonly priority: boolean;
}

function FeaturedTile({ project, priority }: FeaturedTileProps): ReactElement {
  const cover = findCover(project);
  const slug = project.slug as unknown as string;

  return (
    <Link href={`/projects/${slug}`} className="group tile-card">
      <div className="aspect-[4/3] w-full overflow-hidden">
        {cover === null ? (
          <div
            aria-hidden="true"
            className="h-full w-full bg-gradient-to-br from-surface via-background to-surface"
          />
        ) : (
          <ResponsiveImage
            src={cover.url}
            alt={cover.alt}
            width={cover.width}
            height={cover.height}
            priority={priority}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-foreground">
            {project.title}
          </p>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">
            {formatCreationDateLine(project)}
          </p>
        </div>
        <span
          aria-hidden="true"
          className="text-muted transition-colors duration-300 ease-apple group-hover:text-accent"
        >
          →
        </span>
      </div>
    </Link>
  );
}

interface CoverImage {
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

function findCover(project: Project): CoverImage | null {
  const all = project.mediaItems;
  let item = null;
  if (project.coverMediaId !== null) {
    item =
      all.find(
        (m) => (m.id as unknown as string) === (project.coverMediaId as unknown as string),
      ) ?? null;
  }
  if (item === null) {
    item = all.find((m) => m.kind === 'image') ?? null;
  }
  if (item === null) return null;

  return {
    url: item.ref.storageKey,
    alt: item.altText ?? `${project.title} cover image`,
    width: item.ref.width ?? 1600,
    height: item.ref.height ?? 1200,
  };
}

function formatCreationDateLine(project: Project): string {
  const date = project.creationDate as unknown as string;
  const year = date.slice(0, 4);
  return year.length === 4 ? year : 'Featured';
}

interface AboutTeaserProps {
  readonly biography: string;
}

function AboutTeaser({ biography }: AboutTeaserProps): ReactElement {
  const trimmed = biography.trim();
  const preview =
    trimmed.length === 0
      ? 'I’m a 3D generalist working across renders, models, and animation. I’ll add a longer bio here soon.'
      : trimmed.length > 320
        ? `${trimmed.slice(0, 320).trimEnd()}…`
        : trimmed;
  return (
    <section className="border-t border-border/70 bg-surface/40">
      <div className="mx-auto grid max-w-6xl gap-16 px-6 py-32 md:grid-cols-[1fr_2fr]">
        <Reveal>
          <p className="eyebrow">About</p>
          <h2 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-normal tracking-[-0.01em] md:text-6xl">
            A bit
            <br />
            <em className="italic text-accent">of context.</em>
          </h2>
        </Reveal>
        <Reveal delay={140} className="space-y-6 text-lg leading-relaxed text-muted">
          <p>{preview}</p>
          <Link
            href="/about"
            className="inline-block text-xs uppercase tracking-[0.2em] text-accent transition-colors duration-500 ease-soft hover:text-foreground"
            data-cursor-label="learn more"
          >
            Read the full bio →
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
