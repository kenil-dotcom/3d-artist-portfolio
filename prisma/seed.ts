/**
 * Database seed for the 3D Artist Portfolio.
 *
 * Idempotent: every record is inserted via `upsert` keyed on a stable
 * identifier so re-running the seed produces the same database state. Run
 * with `npx prisma db seed` (the `prisma.seed` config in `package.json`
 * dispatches to `tsx prisma/seed.ts`).
 *
 * What this seed creates:
 *   - 3 categories (Renders, Models, Animations)
 *   - 6 tags (character, environment, product, animation, stylized, realistic)
 *   - 1 Bio singleton with a few skills, software entries, and social links
 *   - 8 published projects, each with a single cover image MediaItem whose
 *     storageKey points at a deterministic Picsum URL so the public site has
 *     real imagery to render before the upload pipeline lands.
 *
 * Implementation notes:
 *   - Cover image content hashes are derived from the slug (a short
 *     deterministic SHA-256) so re-running the seed never produces drift.
 *   - Project ids are deterministic v5-style UUIDs derived from the slug, so
 *     `coverMediaId` and `projectId` references stay stable across runs and
 *     the seed remains an upsert (not an insert).
 *   - All projects are published with `publishedAt` ordered chronologically
 *     so the gallery's "newest first" sort produces a sensible default.
 */

import { createHash } from 'node:crypto';
import { PrismaClient, ProjectStatus, MediaKind } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Deterministic id helpers
// ---------------------------------------------------------------------------

/**
 * Build a deterministic UUID v5-shaped string from `name` under a fixed
 * namespace. We don't import the `uuid` package; a SHA-1 over the namespace
 * + name produces enough entropy for a stable, unique-per-name id.
 */
function deterministicUuid(namespace: string, name: string): string {
  const hash = createHash('sha1').update(`${namespace}:${name}`).digest('hex');
  // 8-4-4-4-12 layout. Force version (5) and variant (RFC 4122) bits.
  const part1 = hash.slice(0, 8);
  const part2 = hash.slice(8, 12);
  const part3 = `5${hash.slice(13, 16)}`;
  const v = (parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80;
  const part4 = `${v.toString(16).padStart(2, '0')}${hash.slice(18, 20)}`;
  const part5 = hash.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

const PROJECT_NS = 'portfolio.project';
const MEDIA_NS = 'portfolio.media.cover';
const SOCIAL_NS = 'portfolio.social';

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

interface ProjectSeed {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly categoryId: string;
  readonly tagIds: ReadonlyArray<string>;
  readonly softwareUsed: ReadonlyArray<string>;
  readonly creationDate: string; // YYYY-MM-DD
  readonly publishedAt: string; // ISO-8601
}

const CATEGORIES: ReadonlyArray<{ id: string; name: string; ordering: number }> = [
  { id: 'renders', name: 'Renders', ordering: 0 },
  { id: 'models', name: 'Models', ordering: 1 },
  { id: 'animations', name: 'Animations', ordering: 2 },
];

const TAGS: ReadonlyArray<{ id: string; label: string; ordering: number }> = [
  { id: 'character', label: 'Character', ordering: 0 },
  { id: 'environment', label: 'Environment', ordering: 1 },
  { id: 'product', label: 'Product', ordering: 2 },
  { id: 'animation', label: 'Animation', ordering: 3 },
  { id: 'stylized', label: 'Stylized', ordering: 4 },
  { id: 'realistic', label: 'Realistic', ordering: 5 },
];

const PROJECTS: ReadonlyArray<ProjectSeed> = [
  {
    slug: 'neon-atrium',
    title: 'Neon Atrium',
    description:
      'A cyberpunk lobby scene built in Blender with volumetric god rays, custom shaders, and a real-time path-traced denoise pass. Composed in three lighting variants for time-of-day storyboarding.',
    categoryId: 'renders',
    tagIds: ['environment', 'stylized'],
    softwareUsed: ['Blender', 'Substance Painter', 'DaVinci Resolve'],
    creationDate: '2024-09-12',
    publishedAt: '2024-09-15T10:00:00.000Z',
  },
  {
    slug: 'forge-hammer',
    title: 'Forge Hammer',
    description:
      'Hard-surface product visualization of a smith&apos;s hammer. Fully PBR with hand-painted edge wear and a procedural anisotropic steel pass. Rendered for a marketing print spread.',
    categoryId: 'renders',
    tagIds: ['product', 'realistic'],
    softwareUsed: ['Blender', 'Substance Painter', 'Photoshop'],
    creationDate: '2024-08-04',
    publishedAt: '2024-08-08T10:00:00.000Z',
  },
  {
    slug: 'tidewalker',
    title: 'Tidewalker',
    description:
      'Stylized character sculpt of a deep-sea diver inspired by Studio Ghibli silhouettes. Game-ready topology, baked maps, and a hand-painted diffuse atlas for stylized PBR.',
    categoryId: 'models',
    tagIds: ['character', 'stylized'],
    softwareUsed: ['ZBrush', 'Maya', 'Substance Painter', 'Marmoset Toolbag'],
    creationDate: '2024-06-20',
    publishedAt: '2024-06-25T10:00:00.000Z',
  },
  {
    slug: 'lichen-glade',
    title: 'Lichen Glade',
    description:
      'Procedural environment study of a moss-covered forest clearing. Scatter system driven by Geometry Nodes, with custom mesh-based rocks and hand-modeled hero ferns.',
    categoryId: 'renders',
    tagIds: ['environment', 'realistic'],
    softwareUsed: ['Blender', 'Geometry Nodes', 'Krita'],
    creationDate: '2024-05-02',
    publishedAt: '2024-05-06T10:00:00.000Z',
  },
  {
    slug: 'orbit-drone',
    title: 'Orbit Drone',
    description:
      'Ten-second loop animation of an exploration drone scanning an asteroid surface. Rigged in Blender with a custom IK setup and rendered with motion blur in Cycles.',
    categoryId: 'animations',
    tagIds: ['animation', 'realistic', 'product'],
    softwareUsed: ['Blender', 'After Effects'],
    creationDate: '2024-03-18',
    publishedAt: '2024-03-22T10:00:00.000Z',
  },
  {
    slug: 'bone-carver',
    title: 'Bone Carver',
    description:
      'Stylized creature concept blending dark fantasy and folklore. Real-time presentation with subsurface scattering on the bone armor and hand-keyed idle loop.',
    categoryId: 'models',
    tagIds: ['character', 'stylized'],
    softwareUsed: ['ZBrush', 'Blender', 'Substance Painter', 'Unreal Engine'],
    creationDate: '2024-02-09',
    publishedAt: '2024-02-12T10:00:00.000Z',
  },
  {
    slug: 'ceramic-study',
    title: 'Ceramic Study',
    description:
      'Macro product render of a hand-thrown ceramic mug. Custom subsurface scattering profile for the porcelain glaze with a soft three-point studio HDRI.',
    categoryId: 'renders',
    tagIds: ['product', 'realistic'],
    softwareUsed: ['Blender', 'Substance Designer'],
    creationDate: '2023-12-15',
    publishedAt: '2023-12-18T10:00:00.000Z',
  },
  {
    slug: 'paper-bird-loop',
    title: 'Paper Bird Loop',
    description:
      'Looping paper-craft origami bird flying through a stylized cloud bank. Procedural rigging on the wings with a custom feather modifier driving secondary motion.',
    categoryId: 'animations',
    tagIds: ['animation', 'stylized', 'character'],
    softwareUsed: ['Blender', 'Houdini', 'After Effects'],
    creationDate: '2023-10-04',
    publishedAt: '2023-10-08T10:00:00.000Z',
  },
];

const BIO = {
  artistName: 'Sid07',
  tagline: 'Building worlds, characters, and product stories in 3D.',
  biography:
    'I am a 3D generalist with eight years of experience across game cinematics, advertising, and indie product launches. My toolkit centres on Blender, Substance, and Unreal, with a soft spot for stylised lighting and subtle storytelling beats. I work with studios and direct clients on everything from a single hero shot to long-form animation.',
  skills: [
    'Hard-surface modelling',
    'Character sculpting',
    'PBR texturing',
    'Lighting & lookdev',
    'Procedural environments',
    'Shading & materials',
    'Rigging & animation',
    'Compositing',
  ],
  software: [
    'Blender',
    'ZBrush',
    'Substance Painter',
    'Substance Designer',
    'Maya',
    'Marmoset Toolbag',
    'Unreal Engine',
    'Houdini',
    'After Effects',
    'DaVinci Resolve',
  ],
  socialLinks: [
    { platform: 'ArtStation', url: 'https://www.artstation.com/sid07', ordering: 0 },
    { platform: 'Instagram', url: 'https://instagram.com/sid07.3d', ordering: 1 },
    { platform: 'LinkedIn', url: 'https://www.linkedin.com/in/sid07-3d', ordering: 2 },
  ],
};

// ---------------------------------------------------------------------------
// Seed routine
// ---------------------------------------------------------------------------

async function seedCategories(): Promise<void> {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { id: c.id },
      create: { id: c.id, name: c.name, ordering: c.ordering },
      update: { name: c.name, ordering: c.ordering },
    });
  }
}

async function seedTags(): Promise<void> {
  for (const t of TAGS) {
    await prisma.tag.upsert({
      where: { id: t.id },
      create: { id: t.id, label: t.label, ordering: t.ordering },
      update: { label: t.label, ordering: t.ordering },
    });
  }
}

async function seedBio(): Promise<void> {
  await prisma.bio.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      artistName: BIO.artistName,
      tagline: BIO.tagline,
      biography: BIO.biography,
      skills: [...BIO.skills],
      software: [...BIO.software],
    },
    update: {
      artistName: BIO.artistName,
      tagline: BIO.tagline,
      biography: BIO.biography,
      skills: [...BIO.skills],
      software: [...BIO.software],
    },
  });

  for (const link of BIO.socialLinks) {
    const id = deterministicUuid(SOCIAL_NS, link.platform);
    await prisma.socialLink.upsert({
      where: { id },
      create: {
        id,
        bioId: 'singleton',
        platform: link.platform,
        url: link.url,
        ordering: link.ordering,
      },
      update: {
        bioId: 'singleton',
        platform: link.platform,
        url: link.url,
        ordering: link.ordering,
      },
    });
  }
}

async function seedProjects(): Promise<void> {
  for (const p of PROJECTS) {
    const projectId = deterministicUuid(PROJECT_NS, p.slug);
    const mediaId = deterministicUuid(MEDIA_NS, p.slug);
    const coverUrl = `https://picsum.photos/seed/${p.slug}/1600/1200`;
    const contentHash = shortHash(p.slug);

    // 1. Create / update project (without coverMediaId yet so the FK to a
    //    media item that does not yet exist does not fail on first run).
    await prisma.project.upsert({
      where: { id: projectId },
      create: {
        id: projectId,
        slug: p.slug,
        title: p.title,
        description: p.description,
        categoryId: p.categoryId,
        softwareUsed: [...p.softwareUsed],
        creationDate: new Date(p.creationDate),
        publishedAt: new Date(p.publishedAt),
        status: ProjectStatus.published,
      },
      update: {
        slug: p.slug,
        title: p.title,
        description: p.description,
        categoryId: p.categoryId,
        softwareUsed: [...p.softwareUsed],
        creationDate: new Date(p.creationDate),
        publishedAt: new Date(p.publishedAt),
        status: ProjectStatus.published,
      },
    });

    // 2. Upsert tag join rows. Re-create the set deterministically.
    await prisma.projectTag.deleteMany({ where: { projectId } });
    for (const tagId of p.tagIds) {
      await prisma.projectTag.create({ data: { projectId, tagId } });
    }

    // 3. Upsert the cover media item.
    await prisma.mediaItem.upsert({
      where: { id: mediaId },
      create: {
        id: mediaId,
        projectId,
        storageKey: coverUrl,
        contentHash,
        mimeType: 'image/jpeg',
        width: 1600,
        height: 1200,
        byteSize: 250_000,
        kind: MediaKind.image,
        altText: `${p.title} cover image`,
        caption: null,
        ordering: 0,
      },
      update: {
        projectId,
        storageKey: coverUrl,
        contentHash,
        mimeType: 'image/jpeg',
        width: 1600,
        height: 1200,
        byteSize: 250_000,
        kind: MediaKind.image,
        altText: `${p.title} cover image`,
        caption: null,
        ordering: 0,
      },
    });

    // 4. Point project.coverMediaId at the media item now that it exists.
    await prisma.project.update({
      where: { id: projectId },
      data: { coverMediaId: mediaId },
    });
  }
}

async function main(): Promise<void> {
  console.log('Seeding categories…');
  await seedCategories();
  console.log('Seeding tags…');
  await seedTags();
  console.log('Seeding bio…');
  await seedBio();
  console.log('Seeding projects…');
  await seedProjects();
  console.log('Seed complete.');
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
