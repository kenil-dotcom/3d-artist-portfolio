/**
 * Edge middleware — admin gate.
 *
 * Runs on every request matching `matcher` below. Checks for the
 * `__session_admin` cookie; if absent, redirects to `/admin/login`.
 * Cookie value validity (row existence, idle/hard expiry) is checked
 * deeper in the request lifecycle by `requireAdmin()` because Prisma
 * cannot run on the Edge runtime.
 *
 * The check is intentionally lightweight: an attacker sending a forged
 * cookie reaches the server-side guard which then deletes the cookie
 * via the layout reading `validateSession`, and the layout calls
 * `notFound()` on failure. This double-layer keeps the edge fast while
 * still safe.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME } from '@/lib/auth/cookie';

const LOGIN_PATH = '/admin/login';
const LOGOUT_PATH = '/admin/logout';

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Forward the resolved pathname to server components via a request
  // header so layouts can branch on the URL without re-parsing it.
  // Setting it on the *response* (the previous bug) only mutates the
  // browser-visible response, not what server-side `headers()` reads,
  // so the root layout could never detect admin paths and always tried
  // to render public chrome on /admin/* — breaking the login page.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  // Allow login page and logout endpoint without a session.
  if (pathname === LOGIN_PATH || pathname === LOGOUT_PATH) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (cookie === undefined || cookie.value.length === 0) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/admin/:path*'],
};
