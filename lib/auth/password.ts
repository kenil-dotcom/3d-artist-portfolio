/**
 * Password hashing helpers for the admin CMS.
 *
 * Wraps the `argon2` package with sensible defaults (argon2id, time cost 3,
 * memory cost 64 MB, parallelism 1) so callers don't need to know Argon2
 * tuning. The `verify` helper is constant-time against `argon2.verify` and
 * silently returns `false` on any error so a malformed hash never throws
 * back to the request handler.
 *
 * This module is server-only — `argon2` is a native binding.
 */

import * as argon2 from 'argon2';

/**
 * Argon2id parameters tuned for a single-tenant admin login. The defaults
 * land at roughly ~50 ms per verify on commodity hardware which is the
 * sweet spot for an interactive login: slow enough to throttle password
 * spraying, fast enough that a real Admin doesn't notice.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 64 * 1024,
  parallelism: 1,
};

/**
 * Hash a plaintext password with argon2id. Throws iff the underlying
 * binding rejects the input (e.g. empty buffer); callers should validate
 * password complexity before invoking this.
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash.
 *
 * Returns `true` iff `argon2.verify` matches; any thrown error (malformed
 * hash, version mismatch, native binding failure) is swallowed and
 * reported as `false` so the caller cannot distinguish "wrong password"
 * from "database row corrupt" — both surface the same generic auth
 * failure.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
