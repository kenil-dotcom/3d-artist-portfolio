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
