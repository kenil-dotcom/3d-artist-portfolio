# Prisma

This directory contains the database schema and migrations for the 3D Artist
Portfolio.

- `schema.prisma` — single source of truth for tables, enums, indexes, and
  relations. Mirrors the Domain Models, Inquiry Models, and Authentication and
  Operational Models sections of `.kiro/specs/3d-artist-portfolio/design.md`.
- `migrations/0_init/migration.sql` — initial migration script generated to
  match `schema.prisma`. Authored manually so the schema can be checked in
  before a Postgres instance is available.

## Generating the client

After installing dependencies and configuring `DATABASE_URL`:

```sh
npm install
npm run prisma:generate
```

## Applying the initial migration

In an environment with Postgres reachable via `DATABASE_URL`:

```sh
# Apply on a fresh database
npm run prisma:migrate -- --name init

# Or, if adopting the checked-in SQL as a baseline:
npx prisma migrate resolve --applied "0_init"
```

The schema relies on Postgres' `pgcrypto` extension (used by `gen_random_uuid()`
and earmarked for column-level encryption of inquiry text columns per
Requirement 12.3). The migration enables it on first run.

## Notes

- Postgres enum identifiers cannot contain spaces or hyphens. The schema
  therefore stores `ProjectType.ProductVisualization` (mapped to the
  human-facing label `"Product Visualization"` in the application layer) and
  `DeletionTaskState.failed_manual` (the design's `failed-manual`).
- The `bio` table is a singleton: rows are upserted against the fixed primary
  key `singleton`. The application layer enforces this invariant.
- The canonical store for visitor cookie consent is the first-party
  `consent` cookie. The `consent_records` table is a server-side audit log
  and stores only a one-way hash of the cookie subject, never PII.
