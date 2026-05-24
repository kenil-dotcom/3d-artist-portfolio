'use server';

/**
 * Login server action.
 *
 * Kept in a dedicated file so the action's `'use server'` boundary lives
 * alongside the database access. The page file consumes this through the
 * client form via `useFormState`.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { verifyPassword } from '@/lib/auth/password';
import {
  createSession,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

export interface LoginActionState {
  readonly error: string | null;
  readonly username: string;
}

const LOGIN_DELAY_MS = 1_000;
const GENERIC_ERROR = 'Username or password is incorrect.';

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function padDelay(startMs: number): Promise<void> {
  const elapsed = Date.now() - startMs;
  const remaining = LOGIN_DELAY_MS - elapsed;
  if (remaining > 0) {
    await sleep(remaining);
  }
}

/**
 * Verify credentials, create a session, and redirect to `/admin`.
 *
 * Always pads the response time to at least 1 second so a brute-force
 * attacker can't hammer the endpoint faster than that, and so a
 * "user does not exist" path doesn't leak through faster timing than
 * "wrong password".
 */
export async function loginAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const usernameRaw = formData.get('username');
  const passwordRaw = formData.get('password');
  const username =
    typeof usernameRaw === 'string' ? usernameRaw.trim() : '';
  const password = typeof passwordRaw === 'string' ? passwordRaw : '';

  const start = Date.now();

  if (username.length === 0 || password.length === 0) {
    await padDelay(start);
    return { error: GENERIC_ERROR, username };
  }

  const admin = await prisma.adminUser.findUnique({
    where: { username },
    select: { id: true, passwordHash: true },
  });

  // Run argon2.verify even when no row exists so timing doesn't reveal
  // username existence.
  const passwordHash =
    admin?.passwordHash ??
    '$argon2id$v=19$m=65536,t=3,p=1$ZHVtbXlkdW1teQ$kfqSAFAIQE93C8I3WFvWg4l2vk83HCB0VtMdDQk5xNk';
  const ok = await verifyPassword(password, passwordHash);

  if (admin === null || !ok) {
    await padDelay(start);
    return { error: GENERIC_ERROR, username };
  }

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0 },
  });

  const sessionId = await createSession(admin.id);

  cookies().set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(IDLE_TIMEOUT_MS / 1000),
  });

  await padDelay(start);
  redirect('/admin');
}
