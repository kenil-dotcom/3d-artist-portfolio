/**
 * GET /api/cron/publish-scheduled
 *
 * Vercel-hosted cron route that promotes every Project whose
 * `status = 'scheduled'` and `scheduled_at <= NOW()` to `status =
 * 'published'`. Owns Requirement 7.7, 7.8, 7.11, 7.12 plus the cache
 * revalidation half of Requirements 14.1, 14.2, 14.3.
 *
 * Auth (Requirement 7.11). Vercel injects an `Authorization: Bearer
 * <CRON_SECRET>` header into every cron invocation. We assert the header
 * is present, well-formed (`Bearer <token>`), and matches
 * `process.env.CRON_SECRET` byte-for-byte using `crypto.timingSafeEqual`
 * over equal-length `Buffer`s. Mismatched lengths short-circuit before
 * the timing-safe compare so the comparator never throws. On any auth
 * failure we respond with HTTP 401 and never read or mutate any
 * `projects` row.
 *
 * Promotion (Requirement 7.7, 7.8). A single transactional `UPDATE ...
 * RETURNING id, slug` is dispatched via `prisma.$queryRaw`. The
 * `RETURNING` clause executes in the same round trip so the multi-row
 * promotion is atomic — the worker either flips every due Project or
 * none of them.
 *
 * Revalidation (Requirement 7.12, 14.1–14.3). For each promoted Project
 * we call `revalidatePath('/projects/' + slug)`, then call
 * `revalidatePath('/gallery')` and `revalidatePath('/')` once at the
 * end of the loop (these are project-list surfaces; one revalidation
 * per surface is enough for the whole batch). `revalidatePath` is
 * synchronous in Next.js 14 — it flips an in-process cache tag and
 * returns — so completion is guaranteed before this handler returns.
 * Each call is wrapped in a try/catch so a failure for one slug is
 * logged with the path and reason and the loop continues to the next
 * slug — a single bad slug does not block the rest of the batch
 * (Requirement 7.8 "continue processing"). Any request received after
 * the response returns the newly published Project (Requirement 7.12).
 *
 * Idempotency. Re-invoking with no due rows is a single no-op SQL
 * statement that returns an empty array; no `revalidatePath` is called.
 *
 * Cron cadence is configured in `vercel.json`. The deployed entry uses
 * a five-field cron expression that runs the route every 5 minutes —
 * the minimum interval Vercel allows on the Hobby plan. When the
 * deployment moves to Pro the schedule in `vercel.json` can be
 * tightened to run every minute, lowering the worst-case publish
 * latency from five minutes to one. See `vercel.json` for the literal
 * schedule strings.
 */

import { timingSafeEqual } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Constant-time bearer-token comparison.
 *
 * Returns `true` only when `header` is exactly `Bearer <token>` and
 * `token` matches `expected` byte-for-byte. Mismatched lengths short-
 * circuit before `timingSafeEqual` is called so the underlying
 * comparator never throws on length-mismatched buffers.
 */
function isAuthorized(headerValue: string | null, expected: string): boolean {
  if (headerValue === null) return false;

  const prefix = 'Bearer ';
  if (!headerValue.startsWith(prefix)) return false;

  const supplied = headerValue.slice(prefix.length);
  if (supplied.length === 0) return false;

  const suppliedBuf = Buffer.from(supplied, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  // `timingSafeEqual` throws if the buffers differ in length, so we
  // reject the length mismatch before calling it. The early return is
  // not a timing leak: an attacker can already observe the length of
  // the secret indirectly through any oracle, and the value being
  // compared here is the *attacker-supplied* length, not the secret's
  // entropy.
  if (suppliedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(suppliedBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

interface PromotedRow {
  readonly id: string;
  readonly slug: string;
}

interface SuccessBody {
  readonly ok: true;
  readonly promoted: number;
  readonly slugs: ReadonlyArray<string>;
  readonly revalidationWarnings: ReadonlyArray<string>;
}

interface ErrorBody {
  readonly ok: false;
  readonly error: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET ?? '';

  // When `CRON_SECRET` is unconfigured we refuse every request: there is
  // no safe behaviour for an unauth'd cron endpoint. This keeps a
  // mis-deployed environment from quietly running the promotion loop
  // for anyone who guesses the URL.
  if (expected.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' } satisfies ErrorBody,
      { status: 401 },
    );
  }

  if (!isAuthorized(req.headers.get('authorization'), expected)) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' } satisfies ErrorBody,
      { status: 401 },
    );
  }

  // Single transactional update: `RETURNING id, slug` rides the same
  // round trip as the `UPDATE`, so every due Project flips state and
  // surfaces its slug atomically (Requirement 7.7, 7.8). We cast `id`
  // to text in SQL so the returned shape matches the `PromotedRow`
  // declaration without depending on Prisma's UUID branding.
  const rows = await prisma.$queryRaw<PromotedRow[]>`
    UPDATE projects
       SET status = 'published',
           published_at = COALESCE(published_at, NOW()),
           scheduled_at = NULL
     WHERE status = 'scheduled' AND scheduled_at <= NOW()
    RETURNING id::text AS id, slug
  `;

  const warnings: string[] = [];

  // Per-slug revalidation. `revalidatePath` is synchronous, so each
  // call has fully flipped its in-memory cache tag by the time control
  // returns from `revalidatePath` — the next public request after this
  // handler returns sees the promoted Project (Requirement 7.12). A
  // failure for one slug is logged into `warnings` with the path and
  // reason, and the loop continues — a single bad slug must not block
  // the rest of the batch (Requirement 7.8 "continue processing").
  for (const row of rows) {
    const path = `/projects/${row.slug}`;
    try {
      revalidatePath(path);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const message = `${path}: ${reason}`;
      warnings.push(message);
      console.error('[cron/publish-scheduled] revalidatePath failed', message);
    }
  }

  // List surfaces revalidated once per invocation rather than once per
  // slug. Skip entirely when nothing was promoted to keep the empty-set
  // path a true no-op.
  if (rows.length > 0) {
    for (const path of ['/gallery', '/'] as const) {
      try {
        revalidatePath(path);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const message = `${path}: ${reason}`;
        warnings.push(message);
        console.error('[cron/publish-scheduled] revalidatePath failed', message);
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      promoted: rows.length,
      slugs: rows.map((row) => row.slug),
      revalidationWarnings: warnings,
    } satisfies SuccessBody,
    { status: 200 },
  );
}
