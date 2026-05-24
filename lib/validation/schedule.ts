/**
 * Pure parser and reducer for the scheduled-publishing workflow.
 *
 * The module has two responsibilities:
 *
 *   1. `parseScheduledAt(input, now)` validates the user-supplied
 *      `<input type="datetime-local">` (or ISO-8601) string against the
 *      `(now, now + 365 days]` admissibility window required by
 *      Requirement 7.2. Both bounds collapse onto a single `scheduled_at_in_past`
 *      rejection code so the editor surfaces a unified remediation message
 *      ("pick a closer date").
 *   2. `applyStatusTransition(prev, next, now)` produces the canonical
 *      `(status, scheduledAt, publishedAt)` triple that the persistence
 *      layer must commit when the Admin saves a Project. The rules come
 *      directly from Requirement 7.5 (transition into `published`) and
 *      Requirement 7.6 (transition into `draft`); the `scheduled` branch
 *      satisfies Requirement 7.4 by carrying the parsed `scheduledAt`.
 *
 * The module is intentionally pure: no Prisma client, no clock fallback,
 * no logging. The caller injects `now` so tests can drive time
 * deterministically and the cron route can pass its own server-time anchor.
 *
 * Spec references:
 *   - Requirement 7.2 — `scheduledAt` must be `> now AND <= now + 365 days`.
 *   - Requirement 7.3 — past timestamps reject with `scheduled_at_in_past`.
 *   - Requirement 7.4 — missing/unparseable timestamps reject with
 *     `scheduled_at_missing`.
 *   - Requirement 7.5 — `published` clears `scheduledAt` and sets
 *     `publishedAt` to `now` only when it is currently `null`.
 *   - Requirement 7.6 — `draft` clears both `scheduledAt` and `publishedAt`.
 *
 * Design references:
 *   - "Scheduled publish worker" subsection of design.md.
 *   - Property 2 ("Schedule parser bounds and status transitions").
 */

import type { ProjectStatus } from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Upper bound, in milliseconds, on how far in the future a `scheduledAt`
 * timestamp may sit relative to `now`. Computed as a flat
 * `365 * 86_400_000` so the bound is anchored to elapsed wall-clock
 * milliseconds and does not drift when a DST transition falls inside the
 * window (Requirement 7.2 implementation note).
 */
export const MAX_SCHEDULE_LEAD_MS = 365 * 86_400_000;

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/**
 * Stable rejection codes returned by `parseScheduledAt`. Both bounds of the
 * admissibility window emit `scheduled_at_in_past` so the editor's
 * remediation copy is unified ("pick a closer date").
 */
export type ScheduleParseError =
  | 'scheduled_at_missing'
  | 'scheduled_at_in_past';

/**
 * Result envelope of `parseScheduledAt`. On success carries the parsed
 * `Date`; on failure carries the stable error `code` only.
 */
export type ScheduleParseResult =
  | { readonly ok: true; readonly value: Date }
  | { readonly ok: false; readonly code: ScheduleParseError };

/**
 * Snapshot of the timestamp fields on the persisted Project that
 * `applyStatusTransition` reads from. The reducer ignores `prev.status`
 * because Requirement 7.5–7.6 phrase every rule purely in terms of the
 * `next` status; it is included for caller convenience and forward
 * compatibility.
 */
export interface StatusTransitionState {
  readonly status: ProjectStatus;
  readonly scheduledAt: Date | null;
  readonly publishedAt: Date | null;
}

/**
 * Discriminated input for `applyStatusTransition`. The `scheduled` variant
 * carries the parsed timestamp so the reducer never has to re-validate
 * `parseScheduledAt`'s output and so the caller cannot accidentally hand us
 * an unparsed string.
 */
export type StatusTransitionInput =
  | { readonly status: 'draft' }
  | { readonly status: 'published' }
  | { readonly status: 'scheduled'; readonly scheduledAt: Date };

// ---------------------------------------------------------------------------
// parseScheduledAt
// ---------------------------------------------------------------------------

/**
 * Validate the Admin-supplied `scheduledAt` string against the
 * `(now, now + 365 days]` admissibility window.
 *
 * Acceptance order (deterministic):
 *   1. `input` after trim must be non-empty (Requirement 7.4).
 *   2. `new Date(input)` must produce a finite timestamp
 *      (Requirement 7.4 — "unparseable" rejects the same as missing).
 *   3. The parsed timestamp must satisfy `t > now`
 *      (Requirement 7.3).
 *   4. The parsed timestamp must satisfy
 *      `t <= now.getTime() + MAX_SCHEDULE_LEAD_MS` (Requirement 7.2).
 *
 * Both bound failures (steps 3 and 4) emit `scheduled_at_in_past` so the
 * user-facing remediation message is unified.
 *
 * The function is pure: it does not read the system clock and does not
 * mutate `input` or `now`.
 *
 * @param input The raw string from the form field. May be empty.
 * @param now   The server-time anchor used for the comparison.
 */
export function parseScheduledAt(
  input: string,
  now: Date,
): ScheduleParseResult {
  if (typeof input !== 'string') {
    return { ok: false, code: 'scheduled_at_missing' };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: 'scheduled_at_missing' };
  }

  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) {
    return { ok: false, code: 'scheduled_at_missing' };
  }

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    // Defensive: a non-finite `now` cannot anchor a meaningful comparison.
    // Treat the timestamp as inadmissible rather than letting NaN poison
    // the inequality results below.
    return { ok: false, code: 'scheduled_at_in_past' };
  }

  if (parsedMs <= nowMs) {
    return { ok: false, code: 'scheduled_at_in_past' };
  }

  if (parsedMs > nowMs + MAX_SCHEDULE_LEAD_MS) {
    return { ok: false, code: 'scheduled_at_in_past' };
  }

  return { ok: true, value: new Date(parsedMs) };
}

// ---------------------------------------------------------------------------
// applyStatusTransition
// ---------------------------------------------------------------------------

/**
 * Compute the canonical `(status, scheduledAt, publishedAt)` triple that the
 * persistence layer must commit when the Admin transitions a Project into
 * `next.status`.
 *
 * Rules (per Requirement 7.5–7.6):
 *
 *   - `next.status === 'draft'`     ⇒ `scheduledAt = null`, `publishedAt = null`.
 *   - `next.status === 'published'` ⇒ `scheduledAt = null`,
 *                                     `publishedAt = prev.publishedAt ?? now`
 *                                     (preserves the original publish moment
 *                                     across re-publishes).
 *   - `next.status === 'scheduled'` ⇒ `scheduledAt = next.scheduledAt`,
 *                                     `publishedAt` left as-is. The caller
 *                                     supplies a `Date` already validated by
 *                                     `parseScheduledAt`.
 *
 * The reducer is pure and side-effect free; it does not read the wall clock
 * (the caller passes `now` explicitly) and it does not mutate `prev` or
 * `next`.
 */
export function applyStatusTransition(
  prev: StatusTransitionState,
  next: StatusTransitionInput,
  now: Date,
): StatusTransitionState {
  switch (next.status) {
    case 'draft':
      return {
        status: 'draft',
        scheduledAt: null,
        publishedAt: null,
      };
    case 'published':
      return {
        status: 'published',
        scheduledAt: null,
        publishedAt: prev.publishedAt ?? now,
      };
    case 'scheduled':
      return {
        status: 'scheduled',
        scheduledAt: next.scheduledAt,
        publishedAt: prev.publishedAt,
      };
  }
}
