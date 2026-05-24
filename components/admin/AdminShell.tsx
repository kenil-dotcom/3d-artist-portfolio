/**
 * Admin chrome — top bar with brand, current admin username, and logout
 * button; left rail with primary navigation. Mobile collapses the rail
 * into a top toolbar of pills.
 *
 * This is a server component because none of the chrome is interactive
 * beyond the logout form (which is a normal HTML form posting to
 * `/admin/logout`) and the active-link highlight (handled with CSS via
 * a small client wrapper).
 */

import type { ReactElement, ReactNode } from 'react';

import { AdminNav } from '@/components/admin/AdminNav';

interface AdminShellProps {
  readonly username: string;
  readonly children: ReactNode;
}

export function AdminShell({
  username,
  children,
}: AdminShellProps): ReactElement {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b-2 border-foreground bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-[family-name:var(--font-display)] text-xl font-bold tracking-[-0.03em]">
              Sid07
              <span className="text-[hsl(var(--color-pop-amber))]">.</span>
            </span>
            <span className="rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-honey))] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-foreground">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">
              Signed in as{' '}
              <strong className="text-foreground">{username}</strong>
            </span>
            <form action="/admin/logout" method="post">
              <button type="submit" className="btn-secondary px-4 py-2 text-xs">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-8 lg:flex-row">
        <AdminNav />
        <main id="admin-main" className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
