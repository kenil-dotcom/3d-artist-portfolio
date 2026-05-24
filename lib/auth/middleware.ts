/**
 * Server-side admin guard.
 *
 * Used by the `/admin/*` server components and server actions to assert
 * an authenticated admin is present. On failure we call `notFound()`
 * rather than `redirect()`: returning a 404 body never reveals that a
 * protected route exists, which is preferable for a single-admin CMS.
 *
 * The cookie itself is checked at the edge by `middleware.ts`; this
 * helper double-checks against the database in case the cookie is
 * present but the underlying session row was destroyed (logout from
 * another tab, session sweep, manual delete).
 */

import 'server-only';

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import {
  SESSION_COOKIE_NAME,
  validateSession,
  type SessionAdmin,
  type ValidatedSession,
} from '@/lib/auth/session';

/**
 * Read the session cookie and validate the row. Returns the validated
 * session on success, otherwise calls `notFound()` and never returns.
 *
 * Use this from any server component, server action, or route handler
 * that requires an authenticated admin.
 */
export async function requireAdmin(): Promise<ValidatedSession> {
  const cookieStore = cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME);
  const session = await validateSession(cookie?.value);
  if (session === null) {
    notFound();
  }
  return session;
}

/**
 * Non-throwing variant: returns the session admin if present, else `null`.
 */
export async function getAdminFromRequest(): Promise<SessionAdmin | null> {
  const cookieStore = cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME);
  const session = await validateSession(cookie?.value);
  return session === null ? null : session.admin;
}
