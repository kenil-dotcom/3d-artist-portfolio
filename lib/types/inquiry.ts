/**
 * Inquiry-related types: contact submissions, commission inquiries,
 * reference image attachments, validation errors, and submission contexts.
 *
 * These mirror the Inquiry models and the Request/response DTOs sections of
 * `design.md`. All identifiers are branded.
 */

import type { Brand } from "./brand";
import type { ImageMimeType, IsoDate, IsoTimestamp } from "./domain";

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type InquiryId = Brand<string, "InquiryId">;
export type ReferenceImageId = Brand<string, "ReferenceImageId">;
export type BudgetRangeId = Brand<string, "BudgetRangeId">;
export type JobId = Brand<string, "JobId">;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Discriminator distinguishing the two visitor-facing form pipelines.
 */
export type InquiryType = "contact" | "commission";

/**
 * Lifecycle states for an Inquiry. `pending_deletion` is an operational
 * interim state used by the deletion service (Requirement 12.6) and is not
 * exposed to Admin status filters.
 */
export type InquiryStatus = "new" | "read" | "archived" | "pending_deletion";

/**
 * Status values that Admins may explicitly set via the CMS (excludes the
 * operational `pending_deletion` state managed by the deletion worker).
 */
export type AdminInquiryStatus = Exclude<InquiryStatus, "pending_deletion">;

/**
 * Project type options offered by the Commission Inquiry Form
 * (Requirement 7.2).
 */
export type ProjectType =
  | "Character"
  | "Environment"
  | "Product Visualization"
  | "Animation"
  | "Other";

// ---------------------------------------------------------------------------
// Reference attachments (commission inquiries only)
// ---------------------------------------------------------------------------

/**
 * Persisted reference image attached to a commission inquiry.
 * Per-file size bound is 10 MB and only JPEG/PNG/WebP are accepted.
 */
export interface ReferenceImage {
  readonly id: ReferenceImageId;
  readonly inquiryId: InquiryId;
  /** Canonical key in object storage. */
  readonly storageKey: string;
  /** SHA-256 of the original bytes; embedded in immutable URLs. */
  readonly contentHash: string;
  readonly mimeType: ImageMimeType;
  /** Stored byte size; <= 10 MB per file. */
  readonly byteSize: number;
  /** Filename as supplied by the visitor; echoed in rejection messages. */
  readonly originalFilename: string;
}

/**
 * Admin-configured budget bracket displayed in the commission form selector.
 * The Admin defines between 1 and 10 of these.
 */
export interface BudgetRangeOption {
  readonly id: BudgetRangeId;
  /** Display label, 1..60 chars. */
  readonly label: string;
  /** 0-based position; total options 1..10. */
  readonly ordering: number;
}

// ---------------------------------------------------------------------------
// Persisted Inquiry record
// ---------------------------------------------------------------------------

/**
 * Stored Inquiry row covering both contact and commission submissions.
 * Commission-only fields are nullable for contact rows.
 */
export interface Inquiry {
  readonly id: InquiryId;
  readonly type: InquiryType;
  readonly submittedAt: IsoTimestamp;
  /** 1..100 chars. */
  readonly name: string;
  /** RFC 5322 conformant, 1..254 chars. */
  readonly email: string;
  /** Contact only, 1..200 chars. */
  readonly subject: string | null;
  /** Contact: 10..5000; commission: 20..5000. */
  readonly message: string;
  readonly status: InquiryStatus;

  // Commission-only fields
  readonly projectType: ProjectType | null;
  readonly budgetRangeId: BudgetRangeId | null;
  readonly targetDeadline: IsoDate | null;

  // Operational metadata
  /** Truncated to /24 (IPv4) or /48 (IPv6) to minimize PII. */
  readonly clientIp: string;
  readonly userAgent: string | null;
  /** Audit flag confirming the row was written under encryption-at-rest. */
  readonly encryptedAtRest: boolean;
  readonly notificationJobId: JobId | null;
  /** True iff the notification dispatcher exhausted its retries. */
  readonly deliveryFailed: boolean;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Submission DTOs (request bodies)
// ---------------------------------------------------------------------------

/**
 * Raw contact form submission as parsed from the request before validation.
 */
export interface ContactSubmission {
  readonly name: string;
  readonly email: string;
  readonly subject: string;
  readonly message: string;
}

/**
 * Raw commission form submission as parsed from the request before
 * validation. Reference image files are passed alongside as a separate list.
 */
export interface CommissionInquiry {
  readonly name: string;
  readonly email: string;
  readonly projectType: ProjectType;
  readonly budgetRangeId: BudgetRangeId;
  readonly targetDeadline: IsoDate;
  readonly description: string;
}

/**
 * Per-field validation error returned to the client. `code` values are
 * stable identifiers (e.g. `email_invalid`, `length_min`) used both for
 * localization and for property tests.
 */
export interface FieldError {
  /** Field path, e.g. `"email"` or `"attachments[2]"`. */
  readonly field: string;
  /** Stable, machine-readable error code. */
  readonly code: string;
  /** Human-readable message; localized on the client. */
  readonly message: string;
}

/**
 * Server-side context attached to every inquiry submission.
 */
export interface SubmissionContext {
  readonly clientIp: string;
  readonly captchaToken: string;
  readonly honeypotValue: string | null;
  readonly userAgent: string;
}

/**
 * Result of `submitContact`/`submitCommission`. The same shape is used for
 * success and failure so the client can branch on `ok`/`status`.
 */
export interface SubmissionResult {
  readonly ok: boolean;
  readonly status: 200 | 400 | 422 | 429;
  readonly errors: ReadonlyArray<FieldError>;
  readonly inquiryId: InquiryId | null;
}
