# 3D Artist Portfolio

Public portfolio site and private CMS for a 3D artist. Single Next.js 14 (App Router) + TypeScript application backed by PostgreSQL (Prisma) and S3-compatible object storage.

See [`.kiro/specs/3d-artist-portfolio/`](./.kiro/specs/3d-artist-portfolio/) for the full requirements, design, and task breakdown.

## Prerequisites

- Node.js >= 18.17 (Next.js 14 baseline)
- npm 9+ (or pnpm / yarn — all scripts use `npm` by convention)
- A PostgreSQL instance (local or Docker)
- An S3-compatible bucket and CDN for media (configured in Task 5.5)

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Copy the env template and fill in values (see .env.example for keys)
cp .env.example .env.local

# 3. Start the dev server
npm run dev
```

The app will be available at <http://localhost:3000>.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Lint via `next lint` (ESLint + Next core-web-vitals) |
| `npm run format` | Format with Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the full Vitest suite once |
| `npm run test:watch` | Watch mode |
| `npm run test:pbt` | Property-based tests only (`tests/pbt`) |
| `npm run test:coverage` | Coverage via `@vitest/coverage-v8` |
| `npm run prisma:generate` | Generate the Prisma client (Task 1.3) |
| `npm run prisma:migrate` | Run a Prisma migration in dev (Task 1.3) |

## Project layout

```
app/             # Next.js App Router (public site + /admin CMS)
components/      # React components (media, lightbox, forms, layout, ...)
lib/             # Pure logic and adapters (validation, gallery, media, ...)
prisma/          # Prisma schema + migrations (added in Task 1.3)
tests/
  setup.ts       # Vitest setup (jest-dom + cleanup)
  unit/          # Example-based unit tests
  pbt/           # Property-based tests (fast-check, ≥ 100 iterations)
  e2e/           # Playwright end-to-end tests (Task 8.4 etc.)
```

## Spec-driven development

Every implementation task is listed in `.kiro/specs/3d-artist-portfolio/tasks.md` and links to the requirements clause it satisfies and, where applicable, the property in `design.md` it must preserve. Property tests reference these explicitly via:

```ts
// **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10, 8.7**
```

## Admin CMS

The site ships with a single-admin content management system mounted at `/admin`. It is a thin Next.js layer over Prisma — no NextAuth, no third-party auth — designed for one operator and one artist portfolio.

### Initial setup

Create or rotate the admin account from the command line:

```bash
npm run admin:create
```

The script prompts for a username (1..60 chars) and password (≥ 8 chars, masked input), hashes the password with argon2id, and upserts the row in `admin_users`. Run it any time to rotate credentials — only one admin row exists.

### Logging in

Visit `/admin/login`, enter the credentials you set with `admin:create`, and you'll land on the dashboard. Sessions are HTTP-only, signed cookies that idle out after 8 hours and hard-expire after 24 hours. The login response is artificially padded to ~1 second so the endpoint can't be brute-forced beyond roughly one attempt per second per connection.

To sign out, click "Sign out" in the admin top bar.

### What you can manage

| Section | Notes |
| --- | --- |
| **Dashboard** | Counts for published / draft projects and total / unread inquiries; quick links to the most common actions. |
| **Projects** | Create, edit, delete projects. Each editor covers title, slug (auto-generated from title, editable), description, category, tags, software, creation date, status, cover image, featured order, and the media list (with up/down reordering, alt text, captions, and per-item delete). Publishing is gated by the `validatePublishable` rules — title, cover image, every image media item must have alt text. |
| **Bio** | Singleton bio editor: artist name, tagline, biography, skills (chip multi-input), software (chip multi-input), social links (repeatable rows), profile image upload, resume PDF upload. |
| **Featured** | Pick up to 12 published projects to feature on the landing page; lower numbers come first. The pure validator at `lib/validation/featured.ts` enforces uniqueness and bounds before save. |
| **Inquiries** | Paginated inbox (25 per page) of contact + commission submissions, with type/status filters. The detail view renders every persisted field, reference image thumbnails for commissions, status change controls (mark read / archived / new), and a delete button. |

### Image storage (known limitation)

In dev, uploads are written to `public/uploads/{projectId}/{contentHash}.{ext}` (or `public/uploads/bio/...`). Files are SHA-256 keyed so re-uploading the same image is idempotent and CDN-immutable.

`public/uploads/*` is git-ignored except for `.gitkeep`, so the directory exists in fresh clones but never carries binary blobs.

**This is dev-only.** Vercel's serverless runtime treats the deployment bundle as read-only at runtime — uploads written from a request handler do not persist between invocations. Before going to production, swap the local upload path in `lib/admin/uploads.ts` for an S3/R2-backed implementation (the `lib/storage/` adapters are already wired for this).

