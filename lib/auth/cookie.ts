/**
 * Edge-safe constants shared between the Node session module and the
 * edge middleware. Kept in its own file so the middleware does not pull
 * in `node:crypto` (a Node-only API not available on the Edge runtime).
 */

/**
 * Cookie name for the admin session token.
 *
 * The `__` prefix is used (rather than `__Host-`) because Next.js dev
 * runs over plain HTTP and `__Host-` cookies are rejected by browsers
 * on non-https origins.
 */
export const SESSION_COOKIE_NAME = '__session_admin';
