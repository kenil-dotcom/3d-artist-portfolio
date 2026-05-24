/**
 * Admin section root layout.
 *
 * Top-level layout for every `/admin/*` route. Kept thin so the login
 * route group can opt out of the chrome that the protected route group
 * applies (sidebar, top bar, requireAdmin gate). All admin data is
 * always live, so child segments inherit `force-dynamic`.
 */

import type { ReactElement, ReactNode } from 'react';

export const dynamic = 'force-dynamic';

export default function AdminRootLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <>{children}</>;
}
