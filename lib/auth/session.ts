/**
 * Server-side session storage for the admin CMS.
 *
 * Sessions are issued as opaque, cryptographically random tokens stored in
 * the `sessions` table and carried by the `__session_admin` HTTP-only
 * cookie. We deliberately do not use NextAuth — for a single-admin site it
 * adds complexity (provider chain, JWT roundtrip) without value. A row in
 * `sessions` is the source of truth: deleting it logs the admin out
 * everywhere.
 *
 * Idle / hard expiry rules mirror design.md "Authentication and session":
 *   - Idle: 8 hours from `lastSeenAt`.
 *   - Hard cap: 24 hours from `createdAt`. A request after the hard cap
 *     deletes the session and forces re-login regardless of recent activity.
 *   - Activity inside the idle window slides `lastSeenAt` forward and
 *     extends `expiresAt` to `min(now + 8h, createdAt + 24h)`.
 *
 * Module is server-only (uses `node:crypto` and Prisma).
 */

import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/db/prisma';

import { SESSION_COOKIE_NAME } from './cookie';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export { SESSION_COOKIE_NAME };

/** Idle timeout: 8 hours from last activity. */
export const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

/** Hard cap: 24 hours from session creation. */
export const HARD_EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface SessionAdmin {
  readonly id: string;
  readonly username: string;
}

export interface ValidatedSession {
  readonly id: string;
  readonly admin: SessionAdmin;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate an opaque, URL-safe session id with 256 bits of entropy. The
 * resulting 43-character base64url string is unguessable.
 */
function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Compute the next `expiresAt` given the session's creation time. The
 * effective expiry is the earlier of `now + idle` and `createdAt + hard`.
 */
function computeExpiresAt(now: Date, createdAt: Date): Date {
  const idle = now.getTime() + IDLE_TIMEOUT_MS;
  const hard = createdAt.getTime() + HARD_EXPIRY_MS;
  return new Date(Math.min(idle, hard));
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new session for the given admin and persist it.
 *
 * Returns the opaque session id which the caller should set on the
 * `__session_admin` cookie. The session is valid for up to 8 hours of
 * idle time and at most 24 hours from creation.
 */
export async function createSession(adminId: string): Promise<string> {
  const id = generateSessionId();
  const now = new Date();
  const expiresAt = computeExpiresAt(now, now);

  await prisma.session.create({
    data: {
      id,
      adminId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    },
  });

  return id;
}

/**
 * Validate a session id (the cookie value).
 *
 * Returns the populated session record on success, or `null` for any
 * failure mode:
 *   - cookie absent / empty
 *   - row not found
 *   - past idle timeout (`lastSeenAt + 8h < now`)
 *   - past hard expiry (`createdAt + 24h < now`)
 *
 * On a successful validation the session's `lastSeenAt` and `expiresAt`
 * are slid forward so subsequent requests within the idle window keep
 * the session alive (see design.md "Session activity refresh").
 *
 * Expired rows are deleted opportunistically so they don't accumulate.
 */
export async function validateSession(
  cookieValue: string | null | undefined,
): Promise<ValidatedSession | null> {
  if (cookieValue === null || cookieValue === undefined || cookieValue.length === 0) {
    return null;
  }

  const row = await prisma.session.findUnique({
    where: { id: cookieValue },
    include: {
      admin: { select: { id: true, username: true } },
    },
  });

  if (row === null) {
    return null;
  }

  const now = new Date();
  const hardExpiry = new Date(row.createdAt.getTime() + HARD_EXPIRY_MS);
  const idleDeadline = new Date(row.lastSeenAt.getTime() + IDLE_TIMEOUT_MS);

  if (now >= hardExpiry || now >= idleDeadline) {
    // Best-effort cleanup; ignore errors so a stale row doesn't break login.
    try {
      await prisma.session.delete({ where: { id: row.id } });
    } catch {
      // ignore
    }
    return null;
  }

  // Slide the session forward.
  const newExpiry = computeExpiresAt(now, row.createdAt);
  await prisma.session.update({
    where: { id: row.id },
    data: { lastSeenAt: now, expiresAt: newExpiry },
  });

  return {
    id: row.id,
    admin: { id: row.admin.id, username: row.admin.username },
    createdAt: row.createdAt,
    lastSeenAt: now,
    expiresAt: newExpiry,
  };
}

/**
 * Delete a session row. Safe to call with an unknown id (no-op).
 */
export async function destroySession(sessionId: string): Promise<void> {
  if (sessionId.length === 0) return;
  try {
    await prisma.session.delete({ where: { id: sessionId } });
  } catch {
    // already gone — ignore
  }
}
