/**
 * Admin login page.
 *
 * Renders username + password fields. Submission is handled by the
 * `loginAction` server action defined in `actions.ts` which:
 *   - Verifies the credentials against `admin_users` using argon2.
 *   - Creates a session row + sets the `__session_admin` cookie.
 *   - Redirects to `/admin` on success.
 *
 * On failure the action returns a generic error string so the user
 * cannot distinguish "no such username" from "wrong password" — a
 * small defence against username enumeration.
 *
 * Brute-force defence is intentionally simple for MVP: every login
 * attempt is padded to ~1 s of total response time so a script that
 * hammers `/admin/login` cannot exceed roughly one attempt per second
 * per connection.
 */

import type { ReactElement } from 'react';

import { LoginFormClient } from '@/app/admin/login/LoginFormClient';
import { loginAction, type LoginActionState } from '@/app/admin/login/actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Sign in',
};

const INITIAL_STATE: LoginActionState = { error: null, username: '' };

export default function LoginPage(): ReactElement {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-160px)] max-w-md flex-col justify-center px-6 py-16">
      <div className="surface-card p-8 shadow-[6px_6px_0_0_hsl(var(--color-pop-caramel))]">
        <span className="eyebrow">Admin</span>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-[-0.02em] md:text-5xl">
          Sign{' '}
          <em className="not-italic text-[hsl(var(--color-pop-amber))]">in</em>.
        </h1>
        <p className="mt-3 text-sm text-muted">
          Single-admin CMS. Use the credentials configured via{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 text-xs">
            npm run admin:create
          </code>
          .
        </p>
        <div className="luxe-rule my-8" aria-hidden="true" />
        <LoginFormClient action={loginAction} initialState={INITIAL_STATE} />
      </div>
    </div>
  );
}
