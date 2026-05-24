/**
 * Slug helpers used by the admin CMS.
 *
 * `slugify` is intentionally simple: ASCII-fold, lowercase, replace any
 * non-alphanumeric run with a single hyphen, and trim leading/trailing
 * hyphens. Returns the result truncated to the schema's 80-character
 * cap. The output always conforms to `validateSlug` provided the input
 * contains at least one alphanumeric character; for fully blank input
 * the function returns an empty string and the caller should fall back
 * to a generated id.
 */

import { SLUG_MAX_LENGTH } from '@/lib/validation/project';

const NON_ALNUM = /[^a-z0-9]+/g;
const TRIM_HYPHENS = /^-+|-+$/g;

export function slugify(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const cleaned = normalized.replace(NON_ALNUM, '-').replace(TRIM_HYPHENS, '');
  if (cleaned.length === 0) {
    return '';
  }
  return cleaned.slice(0, SLUG_MAX_LENGTH).replace(TRIM_HYPHENS, '');
}
