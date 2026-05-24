/**
 * CMS / operational types: write inputs, query DTOs, gallery DTOs, admin
 * sessions, background-job records, consent records, and audit events.
 *
 * These mirror the Authentication and Operational models, the
 * Request/response DTOs, and the GalleryQuery / GalleryPageResult sections
 * of `design.md`. Branded identifiers keep admin/session/job ids from
 * mixing with domain ids.
 */

import type { Brand } from "./brand";
import type {
  CategoryId,
  IsoDate,
  IsoTimestamp,
  MediaItem,
  MediaRef,
  Project,
  ProjectStatus,
  Slug,
  SocialLink,
  TagId,
} from "./domain";
import type {
  AdminInquiryStatus,
  Inquiry,
  InquiryId,
  InquiryStatus,
  InquiryType,
  JobId,
  ProjectType,
  ReferenceImage,
} from "./inquiry";

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type AdminId = Brand<string, "AdminId">;
export type SessionId = Brand<string, "SessionId">;
export type DeletionTaskId = Brand<string, "DeletionTaskId">;
export type AuditId = Brand<string, "AuditId">;

// ---------------------------------------------------------------------------
// CMS write inputs
// ---------------------------------------------------------------------------

/**
 * Payload accepted by `createProject`/`updateProject`. References to media
 * are by id so the same media row can be reused as a cover. The CMS
 * validates length bounds and `creationDate <= today` per Requirement 8.2.
 */
export interface ProjectInput {
  readonly title: string;
  readonly description: string;
  readonly slug: Slug;
  readonly categoryId: CategoryId;
  /** 0..20 tags, no duplicates. */
  readonly tagIds: ReadonlyArray<TagId>;
  /** Cover media id; must reference a media item belonging to this project. */
  readonly coverMediaId: Project["coverMediaId"];
  /** 0..20 entries, each 1..60 chars. */
  readonly softwareUsed: ReadonlyArray<string>;
  readonly creationDate: IsoDate;
  readonly status: ProjectStatus;
}

/**
 * Payload accepted by `saveBio`. All fields are validated together; partial
 * updates are not exposed at this layer.
 */
export interface BioInput {
  readonly artistName: string;
  readonly tagline: string;
  readonly biography: string;
  readonly profileImage: MediaRef | null;
  readonly skills: ReadonlyArray<string>;
  readonly software: ReadonlyArray<string>;
  readonly socialLinks: ReadonlyArray<SocialLink>;
  readonly resume: MediaRef | null;
}

// ---------------------------------------------------------------------------
// Gallery query / page result
// ---------------------------------------------------------------------------

/**
 * Sort options exposed to Visitors on the Gallery (Requirement 2.5).
 */
export type GallerySort = "newest" | "oldest" | "title_asc";

/**
 * Parameters parsed from the Gallery URL search params. `tags` has set
 * semantics (order-independent) per Property 3.
 */
export interface GalleryQuery {
  readonly page: number;
  readonly category: CategoryId | null;
  /** 0..10 tag ids; treated as a set. */
  readonly tags: ReadonlyArray<TagId>;
  readonly sort: GallerySort;
}

/**
 * Result returned by `listGallery`. `outOfRange = true` iff the requested
 * page was clamped (Requirement 2.10).
 */
export interface GalleryPageResult {
  /** 0..24 items. */
  readonly items: ReadonlyArray<Project>;
  /** 1-based page number, clamped to `[1, totalPages]`. */
  readonly page: number;
  /** Always >= 1, even when the result set is empty. */
  readonly totalPages: number;
  readonly totalCount: number;
  readonly outOfRange: boolean;
}

// ---------------------------------------------------------------------------
// Inquiry listing / detail DTOs
// ---------------------------------------------------------------------------

/**
 * Conjunctive filter applied to the CMS Inquiries view. `null` on a field
 * means "no filter on this dimension".
 */
export interface InquiryFilter {
  readonly type: InquiryType | null;
  readonly status: AdminInquiryStatus | null;
}

/**
 * Single row in the Inquiries list. Fields are pre-truncated by the server
 * per Property 20 / Requirement 9.2.
 */
export interface InquiryListItem {
  readonly id: InquiryId;
  readonly submittedAt: IsoTimestamp;
  /** Truncated to <= 100 chars. */
  readonly name: string;
  /** Truncated to <= 254 chars. */
  readonly email: string;
  readonly type: InquiryType;
  readonly status: InquiryStatus;
}

/**
 * Paginated Inquiries view returned by `listInquiries`.
 */
export interface InquiryPage {
  /** 0..25 items per page. */
  readonly items: ReadonlyArray<InquiryListItem>;
  readonly page: number;
  readonly totalPages: number;
  readonly totalCount: number;
  /** True iff `items.length === 0`. */
  readonly emptyState: boolean;
}

/**
 * Lightweight reference-image projection used in the Inquiry detail view:
 * a thumbnail URL plus a link to the full-size image.
 */
export interface InquiryAttachmentView {
  readonly id: ReferenceImage["id"];
  readonly thumbnailUrl: string;
  readonly fullSizeUrl: string;
  readonly originalFilename: string;
  readonly byteSize: number;
}

/**
 * Detail DTO returned by `getInquiryDetail`. Surfaces every submitted field
 * plus attachment thumbnails (commission only). `noAttachments = true` for
 * contact inquiries and for commission inquiries with zero attachments.
 */
export interface InquiryDetail {
  readonly id: InquiryId;
  readonly type: InquiryType;
  readonly submittedAt: IsoTimestamp;
  readonly name: string;
  readonly email: string;
  readonly subject: string | null;
  readonly message: string;
  readonly status: InquiryStatus;
  readonly projectType: ProjectType | null;
  readonly budgetRangeId: Inquiry["budgetRangeId"];
  readonly targetDeadline: IsoDate | null;
  readonly attachments: ReadonlyArray<InquiryAttachmentView>;
  readonly noAttachments: boolean;
  readonly deliveryFailed: boolean;
}

// ---------------------------------------------------------------------------
// Authentication and session
// ---------------------------------------------------------------------------

/**
 * Persisted Admin user. Only one such row is expected in the MVP.
 */
export interface AdminUser {
  readonly id: AdminId;
  readonly username: string;
  /** argon2id hash. */
  readonly passwordHash: string;
  /** TOTP shared secret, encrypted at rest. */
  readonly totpSecret: string;
  readonly lastLoginAt: IsoTimestamp | null;
  readonly failedLoginCount: number;
  readonly lockedUntil: IsoTimestamp | null;
}

/**
 * Authenticated Admin session. The `id` is the opaque value carried in the
 * HTTP-only `Secure` `SameSite=Lax` cookie. Idle timeout 8 h, hard cap 24 h.
 */
export interface Session {
  readonly id: SessionId;
  readonly adminId: AdminId;
  readonly createdAt: IsoTimestamp;
  readonly lastSeenAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

/**
 * Lifecycle states shared by the notification dispatcher and the deletion
 * worker. Both bound `attemptCount <= 3`.
 */
export type JobState = "pending" | "succeeded" | "failed";

/**
 * Email notification job for an Inquiry. The dispatcher retries up to 3
 * times within 5 minutes (Requirements 6.8, 7.9).
 */
export interface NotificationJob {
  readonly id: JobId;
  readonly inquiryId: InquiryId;
  /** 0..3. */
  readonly attemptCount: number;
  readonly nextRunAt: IsoTimestamp;
  readonly lastError: string | null;
  readonly state: JobState;
}

/**
 * Terminal state for a deletion task. `failed-manual` indicates the worker
 * exhausted its retries and the inquiry remains in `pending_deletion`.
 */
export type DeletionTaskState = "pending" | "succeeded" | "failed-manual";

/**
 * Inquiry deletion task. Implements Requirements 12.6-12.7: removes the
 * inquiry row, every reference image row, and every storage object within
 * 24 hours, with up to 3 retries.
 */
export interface DeletionTask {
  readonly id: DeletionTaskId;
  readonly inquiryId: InquiryId;
  /** 0..3. */
  readonly attemptCount: number;
  readonly nextRunAt: IsoTimestamp;
  readonly state: DeletionTaskState;
}

// ---------------------------------------------------------------------------
// Consent and audit
// ---------------------------------------------------------------------------

/**
 * Visitor cookie-consent decision. Persisted as a first-party cookie with a
 * 180-day expiry (Requirement 12.5); never stored server-side.
 */
export interface ConsentRecord {
  readonly decision: "accepted" | "rejected";
  readonly decidedAt: IsoTimestamp;
  /** `decidedAt + 180 days`. */
  readonly expiresAt: IsoTimestamp;
}

/**
 * Append-only audit log entry capturing privileged Admin actions.
 */
export interface AuditEvent {
  readonly id: AuditId;
  readonly actorId: AdminId;
  /** Stable action key, e.g. `"project.publish"`, `"inquiry.delete"`. */
  readonly action: string;
  /** Subject of the action when applicable (e.g. `ProjectId` as string). */
  readonly targetId: string | null;
  readonly occurredAt: IsoTimestamp;
  /**
   * Free-form structured metadata (e.g. previous and new status). Limited
   * to JSON-serializable values.
   */
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Re-exported references for convenience
// ---------------------------------------------------------------------------

/**
 * `MediaItem` is referenced by CMS write paths (e.g. `reorderMedia`); we
 * re-export it here so callers can `import { ... } from "@/lib/types/cms"`
 * without crossing module boundaries.
 */
export type { MediaItem };
