/**
 * Authenticated admin layout.
 *
 * Wraps every protected admin page in the chrome (top bar + side nav).
 * `requireAdmin()` is the gate: any request that reaches a child segment
 * is guaranteed to have an authenticated session, otherwise the helper
 * calls `notFound()` and the segment never renders.
 *
 * The layout deliberately replaces the public site header and footer
 * (which is why the root layout skips them when the path starts with
 * `/admin`).
 */

import type { ReactElement, ReactNode } from 'react';

import { AdminShell } from '@/components/admin/AdminShell';
import { requireAdmin } from '@/lib/auth/middleware';

export const dynamic = 'force-dynamic';

export default async function ProtectedAdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const session = await requireAdmin();
  return <AdminShell username={session.admin.username}>{children}</AdminShell>;
}
