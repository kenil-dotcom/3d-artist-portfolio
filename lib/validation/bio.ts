/**
 * Bio header and field validators.
 *
 * Pure (no I/O) Zod-driven validators that mirror the Bio data model in
 * `design.md` and the requirements summarised below:
 *
 * - Requirement 1.2: artist name (1..100) and single-line tagline (1..160).
 * - Requirement 5.1-5.4: biography, profile image, skills, software, social
 *   links, and CV/resume rendering rules. Lengths and counts come from
 *   Requirement 8.9 (CMS save) which is the authoritative bound set.
 * - Requirement 8.9: biography 0..5000, profile image MediaRef, skills
 *   0..30 (each 1..60), software 0..30 (each 1..60), social links 0..15
 *   each a syntactically valid https URL up to 2048 chars, CV one PDF up
 *   to 20 MB.
 *
 * Each function returns a discriminated-union `Result<T, FieldError[]>` so
 * the CMS surface can render every violation at once. Errors carry a
 * stable `code` shared with property tests and client localisation:
 *   - `type_invalid`        — value is not the expected runtime type
 *   - `required`            — required string is missing or empty
 *   - `length_min`          — string length below its minimum (>1)
 *   - `length_max`          — string length above its maximum
 *   - `forbidden_newline`   — tagline contains \r or \n
 *   - `array_max`           — array exceeds its maximum size
 *   - `url_invalid`         — URL is malformed or not https
 *   - `url_max`             — URL exceeds 2048 characters
 *   - `mime_unsupported`    — MediaRef.mimeType not in the allowed set
 *   - `file_too_large`      — MediaRef.byteSize exceeds the limit
 *   - `bytes_invalid`       — MediaRef.byteSize is negative
 */

import { z, type ZodIssue } from 'zod';

import type { FieldError } from '@/lib/types/inquiry';
import type { MediaRef, SocialLink } from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err {
  readonly ok: false;
  readonly errors: ReadonlyArray<FieldError>;
}

export type ValidationResult<T> = Ok<T> | Err;

// ---------------------------------------------------------------------------
// Bounds (mirrored from design.md / Requirement 8.9)
// ---------------------------------------------------------------------------

export const BIO_LIMITS = {
  artistNameMin: 1,
  artistNameMax: 100,
  taglineMin: 1,
  taglineMax: 160,
  biographyMin: 0,
  biographyMax: 5000,
  skillsMax: 30,
  skillEntryMin: 1,
  skillEntryMax: 60,
  softwareMax: 30,
  softwareEntryMin: 1,
  softwareEntryMax: 60,
  socialLinksMax: 15,
  socialPlatformMin: 1,
  socialPlatformMax: 40,
  socialUrlMax: 2048,
  resumeMaxBytes: 20 * 1024 * 1024, // 20 MB
} as const;

export const BIO_PROFILE_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const BIO_RESUME_MIME = 'application/pdf' as const;

// ---------------------------------------------------------------------------
// Validated value shape (returned on success)
// ---------------------------------------------------------------------------

/**
 * MediaRef shape narrowed to a CV/resume PDF. Mirrors `MediaRef` field-by-
 * field but pins `mimeType` to `application/pdf` because the CMS BioInput
 * stores CVs as PDFs only (Requirement 8.9). Defined locally because the
 * canonical `MediaRef.mimeType` union does not include `application/pdf`.
 */
export interface PdfMediaRef {
  readonly storageKey: string;
  readonly contentHash: MediaRef['contentHash'];
  readonly mimeType: typeof BIO_RESUME_MIME;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationSec: number | null;
  readonly byteSize: number;
}

/**
 * MediaRef shape narrowed to a profile image. Pins `mimeType` to one of
 * the allowed image MIME types (Requirement 8.9 references "one profile
 * image"; we accept the same image MIME allow-list as project media).
 */
export interface ProfileImageMediaRef {
  readonly storageKey: string;
  readonly contentHash: MediaRef['contentHash'];
  readonly mimeType: (typeof BIO_PROFILE_IMAGE_MIMES)[number];
  readonly width: number | null;
  readonly height: number | null;
  readonly durationSec: number | null;
  readonly byteSize: number;
}

/**
 * The value returned on a successful `validateBioInput` call.
 */
export interface ValidatedBioInput {
  readonly artistName: string;
  readonly tagline: string;
  readonly biography: string;
  readonly profileImage: ProfileImageMediaRef | null;
  readonly skills: ReadonlyArray<string>;
  readonly software: ReadonlyArray<string>;
  readonly socialLinks: ReadonlyArray<SocialLink>;
  readonly resume: PdfMediaRef | null;
}

/**
 * The successful header value: artist name plus tagline.
 */
export interface ValidatedBioHeader {
  readonly artistName: string;
  readonly tagline: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true iff `value` parses as an absolute https URL with a non-empty
 * hostname. Uses the WHATWG URL parser so validation matches what browsers
 * will actually open from rendered Bio links.
 */
function isHttpsUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname.length === 0) return false;
  return true;
}

/**
 * Render a Zod issue path as a stable field path identifier:
 *   `['socialLinks', 0, 'url']` -> `'socialLinks[0].url'`.
 */
function joinPath(path: readonly (string | number)[]): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') {
      out += `[${seg}]`;
    } else {
      out += out.length === 0 ? seg : `.${seg}`;
    }
  }
  return out;
}

/**
 * Translate a `ZodIssue` into the stable `FieldError` shape consumed by
 * the CMS surface and property tests.
 *
 * - `custom` issues whose `params.code` is set forward that code verbatim
 *   (used by every domain-specific check below: `forbidden_newline`,
 *   `mime_unsupported`, `url_invalid`, `url_max`, `file_too_large`,
 *   `bytes_invalid`, plus any explicit `type_invalid` we emit ourselves).
 * - `invalid_type` becomes `type_invalid`.
 * - `too_small` on a string with `minimum <= 1` becomes `required`
 *   (this is the only way `min(1)` can fail), otherwise `length_min`.
 * - `too_big` on strings becomes `length_max`; on arrays becomes
 *   `array_max`.
 * - Anything unexpected falls back to `invalid` so the error surface
 *   remains total.
 *
 * When the issue path is empty (e.g. the entire input is the wrong
 * type), the field is reported as `'input'`.
 */
function translateIssue(issue: ZodIssue): FieldError {
  const field = joinPath(issue.path) || 'input';

  if (issue.code === z.ZodIssueCode.custom) {
    const params = issue.params as { code?: string } | undefined;
    if (params && typeof params.code === 'string') {
      return { field, code: params.code, message: issue.message };
    }
  }

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { field, code: 'type_invalid', message: issue.message };
    case z.ZodIssueCode.too_small: {
      if (issue.type === 'string') {
        const min =
          typeof issue.minimum === 'bigint'
            ? Number(issue.minimum)
            : issue.minimum;
        if (min <= 1) {
          return { field, code: 'required', message: issue.message };
        }
        return { field, code: 'length_min', message: issue.message };
      }
      if (issue.type === 'array') {
        return { field, code: 'array_min', message: issue.message };
      }
      return { field, code: 'too_small', message: issue.message };
    }
    case z.ZodIssueCode.too_big: {
      if (issue.type === 'string') {
        return { field, code: 'length_max', message: issue.message };
      }
      if (issue.type === 'array') {
        return { field, code: 'array_max', message: issue.message };
      }
      return { field, code: 'too_big', message: issue.message };
    }
    default:
      return { field, code: 'invalid', message: issue.message };
  }
}

// ---------------------------------------------------------------------------
// Field-level Zod schemas
// ---------------------------------------------------------------------------

const artistNameSchema = z
  .string()
  .min(BIO_LIMITS.artistNameMin)
  .max(BIO_LIMITS.artistNameMax);

const taglineSchema = z
  .string()
  .min(BIO_LIMITS.taglineMin)
  .max(BIO_LIMITS.taglineMax)
  .superRefine((val, ctx) => {
    if (/[\r\n]/.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'forbidden_newline' },
        message: 'tagline must not contain line breaks.',
      });
    }
  });

const biographySchema = z
  .string()
  .min(BIO_LIMITS.biographyMin)
  .max(BIO_LIMITS.biographyMax);

/**
 * Common MediaRef shape used by both profile image and resume schemas.
 * `mimeType`, `width`, `height`, `durationSec`, and `byteSize` are typed
 * as `unknown` so the per-MediaRef superRefine below can apply the
 * MediaRef-specific rules (allow-list, size cap) without prematurely
 * failing the type check.
 */
const baseMediaRefSchema = z
  .object({
    storageKey: z.string().min(1),
    contentHash: z.string().min(1),
    mimeType: z.unknown(),
    width: z.unknown(),
    height: z.unknown(),
    durationSec: z.unknown(),
    byteSize: z.unknown(),
  })
  .passthrough();

const profileImageSchema = baseMediaRefSchema.superRefine((val, ctx) => {
  // mimeType must be one of the allowed image MIME types.
  if (typeof val.mimeType !== 'string') {
    ctx.addIssue({
      path: ['mimeType'],
      code: z.ZodIssueCode.custom,
      params: { code: 'type_invalid' },
      message: 'profileImage.mimeType must be a string.',
    });
  } else if (
    !(BIO_PROFILE_IMAGE_MIMES as readonly string[]).includes(val.mimeType)
  ) {
    ctx.addIssue({
      path: ['mimeType'],
      code: z.ZodIssueCode.custom,
      params: { code: 'mime_unsupported' },
      message: `profileImage.mimeType must be one of ${BIO_PROFILE_IMAGE_MIMES.join(', ')}.`,
    });
  }

  // byteSize must be a non-negative finite number. No upper bound here:
  // image-side limits are enforced by the media upload pipeline (Req 8.4).
  if (typeof val.byteSize !== 'number' || !Number.isFinite(val.byteSize)) {
    ctx.addIssue({
      path: ['byteSize'],
      code: z.ZodIssueCode.custom,
      params: { code: 'type_invalid' },
      message: 'profileImage.byteSize must be a finite number.',
    });
  } else if (val.byteSize < 0) {
    ctx.addIssue({
      path: ['byteSize'],
      code: z.ZodIssueCode.custom,
      params: { code: 'bytes_invalid' },
      message: 'profileImage.byteSize must be non-negative.',
    });
  }
});

const resumeSchema = baseMediaRefSchema.superRefine((val, ctx) => {
  // mimeType must be exactly application/pdf.
  if (typeof val.mimeType !== 'string') {
    ctx.addIssue({
      path: ['mimeType'],
      code: z.ZodIssueCode.custom,
      params: { code: 'type_invalid' },
      message: 'resume.mimeType must be a string.',
    });
  } else if (val.mimeType !== BIO_RESUME_MIME) {
    ctx.addIssue({
      path: ['mimeType'],
      code: z.ZodIssueCode.custom,
      params: { code: 'mime_unsupported' },
      message: `resume.mimeType must be ${BIO_RESUME_MIME}.`,
    });
  }

  // byteSize must be finite, non-negative, and <= 20 MB.
  if (typeof val.byteSize !== 'number' || !Number.isFinite(val.byteSize)) {
    ctx.addIssue({
      path: ['byteSize'],
      code: z.ZodIssueCode.custom,
      params: { code: 'type_invalid' },
      message: 'resume.byteSize must be a finite number.',
    });
  } else if (val.byteSize < 0) {
    ctx.addIssue({
      path: ['byteSize'],
      code: z.ZodIssueCode.custom,
      params: { code: 'bytes_invalid' },
      message: 'resume.byteSize must be non-negative.',
    });
  } else if (val.byteSize > BIO_LIMITS.resumeMaxBytes) {
    ctx.addIssue({
      path: ['byteSize'],
      code: z.ZodIssueCode.custom,
      params: { code: 'file_too_large' },
      message: `resume must be at most ${BIO_LIMITS.resumeMaxBytes} bytes.`,
    });
  }
});

const socialLinkSchema = z
  .object({
    platform: z
      .string()
      .min(BIO_LIMITS.socialPlatformMin)
      .max(BIO_LIMITS.socialPlatformMax),
    // The URL is constrained by `min(1)` so that an empty value reports as
    // `required`; the rest of the URL rules (length cap, https-only) live
    // in a custom refinement so they emit `url_max` / `url_invalid` codes
    // instead of generic `length_max` / `invalid_string`.
    url: z
      .string()
      .min(1)
      .superRefine((val, ctx) => {
        if (val.length === 0) return;
        if (val.length > BIO_LIMITS.socialUrlMax) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            params: { code: 'url_max' },
            message: `url must be at most ${BIO_LIMITS.socialUrlMax} characters.`,
          });
          return;
        }
        if (!isHttpsUrl(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            params: { code: 'url_invalid' },
            message: 'url must be an https URL.',
          });
        }
      }),
    ordering: z.number().refine((v) => Number.isFinite(v), {
      params: { code: 'type_invalid' },
      message: 'ordering must be a finite number.',
    }),
  })
  .passthrough();

const stringListSchema = (
  maxCount: number,
  entryMin: number,
  entryMax: number
) => z.array(z.string().min(entryMin).max(entryMax)).max(maxCount);

const headerSchema = z.object({
  artistName: artistNameSchema,
  tagline: taglineSchema,
});

const bioInputSchema = z
  .object({
    artistName: artistNameSchema,
    tagline: taglineSchema,
    biography: biographySchema,
    profileImage: profileImageSchema.nullable(),
    skills: stringListSchema(
      BIO_LIMITS.skillsMax,
      BIO_LIMITS.skillEntryMin,
      BIO_LIMITS.skillEntryMax
    ),
    software: stringListSchema(
      BIO_LIMITS.softwareMax,
      BIO_LIMITS.softwareEntryMin,
      BIO_LIMITS.softwareEntryMax
    ),
    socialLinks: z.array(socialLinkSchema).max(BIO_LIMITS.socialLinksMax),
    resume: resumeSchema.nullable(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate the Bio header pair (artist name + tagline) used on the landing
 * page (Requirement 1.2).
 *
 * Succeeds iff:
 *   - `1 <= len(name) <= 100`,
 *   - `1 <= len(tagline) <= 160`, and
 *   - `tagline` contains no `\n` or `\r`.
 *
 * On failure returns one stable `FieldError` per violated rule. Both
 * inputs are checked independently so a caller submitting two invalid
 * fields receives the full violation set in a single call.
 */
export function validateBioHeader(
  name: unknown,
  tagline: unknown
): ValidationResult<ValidatedBioHeader> {
  const result = headerSchema.safeParse({ artistName: name, tagline });
  if (result.success) {
    return {
      ok: true,
      value: {
        artistName: result.data.artistName,
        tagline: result.data.tagline,
      },
    };
  }
  return {
    ok: false,
    errors: result.error.issues.map(translateIssue),
  };
}

/**
 * Validate a complete BioInput payload (Requirement 8.9 plus the
 * presentation rules from Requirements 5.1-5.4).
 *
 * Succeeds iff every per-field rule below holds:
 *   - artistName 1..100, tagline 1..160 single-line (Requirement 1.2)
 *   - biography 0..5000
 *   - profileImage null or a MediaRef with mimeType in
 *     {image/jpeg, image/png, image/webp}
 *   - skills: 0..30 entries, each 1..60
 *   - software: 0..30 entries, each 1..60
 *   - socialLinks: 0..15 entries, each with platform 1..40, https URL
 *     <=2048 chars, and a finite ordering
 *   - resume null or a MediaRef with mimeType=application/pdf and
 *     byteSize <= 20 MB
 *
 * On failure returns one stable FieldError per violated rule (no
 * duplicates across fields) so the CMS surface can present every issue
 * in a single response.
 */
export function validateBioInput(
  input: unknown
): ValidationResult<ValidatedBioInput> {
  const result = bioInputSchema.safeParse(input);
  if (result.success) {
    return {
      ok: true,
      value: result.data as unknown as ValidatedBioInput,
    };
  }
  return {
    ok: false,
    errors: result.error.issues.map(translateIssue),
  };
}
