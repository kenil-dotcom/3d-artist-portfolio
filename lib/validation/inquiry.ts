/**
 * Pure validators for the public Contact and Commission Inquiry forms.
 *
 * These validators are pure and side-effect free: every dependency on the
 * "current day" flows in via a `Date` or `Clock` parameter so property and
 * unit tests can drive time deterministically.
 *
 * The rules are encoded as Zod schemas (`contactSubmissionSchema`,
 * `createCommissionInquirySchema`) so the same source of truth is reused by
 * the React Hook Form clients (Task 8.2 and 8.3) and by server-side parsing.
 * The wrapper functions below run those schemas and translate Zod issues
 * into a stable `FieldError[]` shape, preserving the visitor's entered
 * values per Requirements 6.4 and 7.5 (the validator never trims, coerces,
 * or echoes input back -- the caller keeps the original payload to redisplay).
 *
 * Spec references:
 * - Requirement 6.1, 6.4: Contact form field bounds & validation behaviour.
 * - Requirement 7.1, 7.2, 7.5: Commission form field bounds, project-type
 *   enum, target-deadline floor at submission date.
 * - Design > Inquiry models > Validation rules.
 *
 * Stable error codes emitted (intentionally machine-readable identifiers
 * shared with the client and property tests):
 *   - `required`        - field missing, not a string, or empty/whitespace.
 *   - `length_min`      - field shorter than its minimum bound.
 *   - `length_max`      - field longer than its maximum bound.
 *   - `email_invalid`   - email does not match the RFC 5322 pattern.
 *   - `enum_invalid`    - value not in the allowed enum/set.
 *   - `date_invalid`    - target deadline not a valid `YYYY-MM-DD` date.
 *   - `deadline_past`   - target deadline before the resolved "today".
 */

import { z, type ZodIssue } from 'zod';

import type { Clock } from '@/lib/clock';
import type {
  BudgetRangeId,
  ContactSubmission,
  CommissionInquiry,
  FieldError,
  ProjectType,
} from '@/lib/types/inquiry';
import type { IsoDate } from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

/**
 * Discriminated union returned by every validator in this module. On
 * success, `value` carries the validated, narrowly-typed submission. On
 * failure, `errors` lists every violated rule (validators report all
 * violations, not just the first one).
 */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: ReadonlyArray<FieldError> };

// ---------------------------------------------------------------------------
// Field bound constants (mirrors design.md's "Validation rules" section)
// ---------------------------------------------------------------------------

export const NAME_MIN = 1;
export const NAME_MAX = 100;

export const EMAIL_MAX = 254;

export const SUBJECT_MIN = 1;
export const SUBJECT_MAX = 200;

export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 5_000;

export const COMMISSION_DESCRIPTION_MIN = 20;
export const COMMISSION_DESCRIPTION_MAX = 5_000;

/**
 * Project type enum offered by the Commission form (Requirement 7.2).
 * Ordered to match the design's display order.
 */
export const PROJECT_TYPES: ReadonlyArray<ProjectType> = [
  'Character',
  'Environment',
  'Product Visualization',
  'Animation',
  'Other',
];

/**
 * Practical RFC 5322 email pattern. Mirrors the WHATWG HTML living-standard
 * "valid email address" production with the additional constraint that the
 * domain must contain at least one `.` (so a TLD is required). Total length
 * is capped separately at {@link EMAIL_MAX} per Requirement 6.1.
 */
const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/** Calendar-date pattern at day granularity (`YYYY-MM-DD`). */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sentinel `params` key used on every `ctx.addIssue` call to attach a
 * stable, machine-readable error code. The `mapIssues` helper reads this
 * key (falling back to a translation of Zod's built-in issue codes when
 * absent) so callers see a stable `code` regardless of how the underlying
 * schema raised the issue.
 */
const CODE_KEY = 'code';

// ---------------------------------------------------------------------------
// Internal Zod helpers
// ---------------------------------------------------------------------------

/**
 * Add a custom Zod issue carrying a stable error code in `params.code`.
 *
 * The issue path is left empty: Zod automatically prepends the parent
 * object key when the refinement runs inside an `z.object({ field: ... })`
 * shape, so an empty relative path produces `[field]` after composition.
 */
function addCodedIssue(
  ctx: z.RefinementCtx,
  _field: string,
  code: string,
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [],
    params: { [CODE_KEY]: code },
    message,
  });
}

/**
 * Build a Zod schema fragment for a required, length-bounded string field
 * scoped to `field`. Emits `required` for missing/empty/whitespace-only
 * values, then `length_min`/`length_max` for length violations.
 *
 * Using `z.unknown().superRefine` gives us full control over the issue
 * `path` and `code` regardless of the input's runtime type, which keeps
 * the FieldError mapping uniform for objects, nulls, numbers, etc.
 */
function boundedString(
  field: string,
  min: number,
  max: number,
): z.ZodEffects<z.ZodUnknown, unknown, unknown> {
  return z.unknown().superRefine((value, ctx) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      addCodedIssue(ctx, field, 'required', `${field} is required`);
      return;
    }
    if (value.length < min) {
      addCodedIssue(
        ctx,
        field,
        'length_min',
        `${field} must be at least ${min} characters`,
      );
      return;
    }
    if (value.length > max) {
      addCodedIssue(
        ctx,
        field,
        'length_max',
        `${field} must be at most ${max} characters`,
      );
    }
  });
}

/**
 * Email schema fragment: required, length-capped at {@link EMAIL_MAX},
 * and RFC 5322 conformant (Requirement 6.1).
 */
function emailField(
  field: string,
): z.ZodEffects<z.ZodUnknown, unknown, unknown> {
  return z.unknown().superRefine((value, ctx) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      addCodedIssue(ctx, field, 'required', `${field} is required`);
      return;
    }
    if (value.length > EMAIL_MAX) {
      addCodedIssue(
        ctx,
        field,
        'length_max',
        `${field} must be at most ${EMAIL_MAX} characters`,
      );
      // Continue so the syntactic check still runs and reports both issues.
    }
    if (!EMAIL_PATTERN.test(value)) {
      addCodedIssue(
        ctx,
        field,
        'email_invalid',
        `${field} is not a valid address`,
      );
    }
  });
}

/**
 * Project-type schema fragment. Empty/missing values yield `required`;
 * non-enum values yield `enum_invalid`.
 */
function projectTypeField(
  field: string,
): z.ZodEffects<z.ZodUnknown, unknown, unknown> {
  const allowed = new Set<string>(PROJECT_TYPES as ReadonlyArray<string>);
  return z.unknown().superRefine((value, ctx) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      addCodedIssue(ctx, field, 'required', `${field} is required`);
      return;
    }
    if (!allowed.has(value)) {
      addCodedIssue(
        ctx,
        field,
        'enum_invalid',
        `${field} must be one of: ${PROJECT_TYPES.join(', ')}`,
      );
    }
  });
}

/**
 * Budget range schema fragment. When `allowedIds` is supplied, the value
 * must be a member; otherwise any non-empty string is accepted (the
 * caller is responsible for checking against admin-configured ids at the
 * service layer when no allow-list is wired through).
 */
function budgetRangeField(
  field: string,
  allowedIds: ReadonlySet<string> | null,
): z.ZodEffects<z.ZodUnknown, unknown, unknown> {
  return z.unknown().superRefine((value, ctx) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      addCodedIssue(ctx, field, 'required', `${field} is required`);
      return;
    }
    if (allowedIds !== null && !allowedIds.has(value)) {
      addCodedIssue(
        ctx,
        field,
        'enum_invalid',
        `${field} must be one of the configured budget ranges`,
      );
    }
  });
}

/**
 * Target-deadline schema fragment. Verifies syntax (`YYYY-MM-DD`),
 * calendar validity (rejects e.g. `2024-02-30`), and that the date is
 * on or after the resolved "today" (Requirement 7.1, 7.5).
 */
function targetDeadlineField(
  field: string,
  todayKey: string,
): z.ZodEffects<z.ZodUnknown, unknown, unknown> {
  return z.unknown().superRefine((value, ctx) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      addCodedIssue(ctx, field, 'required', `${field} is required`);
      return;
    }
    if (!ISO_DATE_PATTERN.test(value)) {
      addCodedIssue(
        ctx,
        field,
        'date_invalid',
        `${field} must be a calendar date in YYYY-MM-DD format`,
      );
      return;
    }
    if (parseCalendarDate(value) === null) {
      addCodedIssue(
        ctx,
        field,
        'date_invalid',
        `${field} is not a real calendar date`,
      );
      return;
    }
    if (value < todayKey) {
      addCodedIssue(
        ctx,
        field,
        'deadline_past',
        `Deadline must be today or a future date`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Public Zod schemas (consumed by React Hook Form resolvers)
// ---------------------------------------------------------------------------

/**
 * Zod schema for {@link ContactSubmission}. Rules:
 *   - `name`: 1..{@link NAME_MAX} chars, non-whitespace.
 *   - `email`: RFC 5322 conformant, 1..{@link EMAIL_MAX} chars.
 *   - `subject`: {@link SUBJECT_MIN}..{@link SUBJECT_MAX} chars,
 *     non-whitespace.
 *   - `message`: {@link CONTACT_MESSAGE_MIN}..{@link CONTACT_MESSAGE_MAX}
 *     chars, non-whitespace.
 *
 * Issues attach `params.code` so consumers can branch on stable codes.
 */
export const contactSubmissionSchema = z
  .object({
    name: boundedString('name', NAME_MIN, NAME_MAX),
    email: emailField('email'),
    subject: boundedString('subject', SUBJECT_MIN, SUBJECT_MAX),
    message: boundedString(
      'message',
      CONTACT_MESSAGE_MIN,
      CONTACT_MESSAGE_MAX,
    ),
  })
  .strip();

/** Optional configuration consumed by `createCommissionInquirySchema`. */
export interface CommissionSchemaOptions {
  /**
   * Today's calendar date as `YYYY-MM-DD` (UTC). Used as the lower bound
   * for `targetDeadline` (Requirement 7.1, 7.5).
   */
  readonly todayKey: string;
  /**
   * If provided, restricts `budgetRangeId` to one of these admin-configured
   * ids. When omitted, any non-empty string is accepted and budget-range
   * membership is enforced at the service layer (e.g. in `submitCommission`).
   */
  readonly allowedBudgetRangeIds?: ReadonlySet<string> | null;
}

/**
 * Build the Zod schema for {@link CommissionInquiry}. Curried over the
 * "today" cut-off (and optional allow-list) so the schema remains pure.
 */
export function createCommissionInquirySchema(
  options: CommissionSchemaOptions,
): z.ZodTypeAny {
  return z
    .object({
      name: boundedString('name', NAME_MIN, NAME_MAX),
      email: emailField('email'),
      projectType: projectTypeField('projectType'),
      budgetRangeId: budgetRangeField(
        'budgetRangeId',
        options.allowedBudgetRangeIds ?? null,
      ),
      targetDeadline: targetDeadlineField('targetDeadline', options.todayKey),
      description: boundedString(
        'description',
        COMMISSION_DESCRIPTION_MIN,
        COMMISSION_DESCRIPTION_MAX,
      ),
    })
    .strip();
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** Field paths the contact validator emits required errors for when the
 *  input is not an object. Kept in declaration order for stable test
 *  assertions. */
const CONTACT_FIELDS = ['name', 'email', 'subject', 'message'] as const;

/** Field paths the commission validator emits required errors for when the
 *  input is not an object. */
const COMMISSION_FIELDS = [
  'name',
  'email',
  'projectType',
  'budgetRangeId',
  'targetDeadline',
  'description',
] as const;

/**
 * Validate a Contact form submission.
 *
 * Returns `{ ok: true, value }` on success or `{ ok: false, errors }` with
 * every violated rule. Validators preserve the caller's entered values; no
 * trimming or coercion is performed beyond type narrowing (the visitor's
 * original payload is what the UI redisplays per Requirement 6.4).
 */
export function validateContactSubmission(
  input: unknown,
): ValidationResult<ContactSubmission> {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: CONTACT_FIELDS.map((field) => requiredError(field)),
    };
  }

  const result = contactSubmissionSchema.safeParse(input);
  if (!result.success) {
    return { ok: false, errors: mapIssues(result.error.issues) };
  }

  const parsed = result.data as ContactSubmission;
  return { ok: true, value: parsed };
}

/**
 * Validate a Commission Inquiry submission.
 *
 * The "today" floor for `targetDeadline` is supplied via a `Date` or
 * `Clock` (Requirement 7.1, 7.5). Comparisons are performed at calendar-day
 * granularity in UTC so equal-day deadlines pass and time-of-day is ignored.
 *
 * Pass `options.allowedBudgetRangeIds` to enforce membership against the
 * admin-configured budget range set; when omitted, the validator only
 * checks presence and the service layer enforces membership.
 */
export function validateCommissionSubmission(
  input: unknown,
  today: Date | Clock,
  options: { allowedBudgetRangeIds?: ReadonlySet<string> | null } = {},
): ValidationResult<CommissionInquiry> {
  const todayKey = toCalendarDayKey(resolveToday(today));

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: COMMISSION_FIELDS.map((field) => requiredError(field)),
    };
  }

  const schema = createCommissionInquirySchema({
    todayKey,
    allowedBudgetRangeIds: options.allowedBudgetRangeIds ?? null,
  });

  const result = schema.safeParse(input);
  if (!result.success) {
    return { ok: false, errors: mapIssues(result.error.issues) };
  }

  const parsed = result.data as {
    name: string;
    email: string;
    projectType: ProjectType;
    budgetRangeId: string;
    targetDeadline: string;
    description: string;
  };

  return {
    ok: true,
    value: {
      name: parsed.name,
      email: parsed.email,
      projectType: parsed.projectType,
      budgetRangeId: parsed.budgetRangeId as BudgetRangeId,
      targetDeadline: parsed.targetDeadline as IsoDate,
      description: parsed.description,
    },
  };
}

// ---------------------------------------------------------------------------
// Issue mapping
// ---------------------------------------------------------------------------

/**
 * Translate Zod issues into stable {@link FieldError} entries. Issues
 * raised through {@link addCodedIssue} carry a `params.code`; any other
 * issue (which shouldn't happen with the schemas above but is handled
 * defensively) falls back to its Zod issue code.
 */
function mapIssues(issues: ReadonlyArray<ZodIssue>): FieldError[] {
  return issues.map((issue) => {
    const field = issue.path
      .map((segment) => String(segment))
      .filter((segment) => segment.length > 0)
      .join('.');
    const params = (issue as { params?: Record<string, unknown> }).params ?? {};
    const code =
      typeof params[CODE_KEY] === 'string'
        ? (params[CODE_KEY] as string)
        : issue.code;
    return {
      field: field === '' ? '_root' : field,
      code,
      message: issue.message,
    };
  });
}

function requiredError(field: string): FieldError {
  return {
    field,
    code: 'required',
    message: `${field} is required`,
  };
}

// ---------------------------------------------------------------------------
// Date / runtime helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse a `YYYY-MM-DD` string into a UTC Date, returning `null` if the
 * components do not represent a real calendar date (e.g. `2024-02-30`).
 */
function parseCalendarDate(value: string): Date | null {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

function toCalendarDayKey(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveToday(today: Date | Clock): Date {
  if (today instanceof Date) {
    return today;
  }
  return today.now();
}
