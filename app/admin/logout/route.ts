/**
 * POST /admin/logout
 *
 * Destroys the current admin session row, clears the cookie, and
 * redirects to `/admin/login`. Safe to call without a session — in
 * that case the cookie clear is a no-op.
 */

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { destroySession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieStore = cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (cookie !== undefined && cookie.value.length > 0) {
    await destroySession(cookie.value);
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/admin/login';
  loginUrl.search = '';

  const response = NextResponse.redirect(loginUrl, { status: 303 });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
