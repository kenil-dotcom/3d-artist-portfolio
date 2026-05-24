# Implementation Plan: 3D Artist Portfolio

## Overview

This plan converts the requirements and design into a sequence of incremental, code-only tasks for a code-generation LLM. The implementation language is **TypeScript** running on **Next.js 14 (App Router)** with **PostgreSQL via Prisma** and S3-compatible object storage, as specified in the design.

Each task builds on the previous ones and ends with wiring components together so no code is left orphaned. Tests (unit, property-based, integration, component) appear as sub-tasks under the implementation they validate. Property-based tests use `fast-check` with at least 100 iterations per property, and each one references a property from the design's "Correctness Properties" section and the requirements clause it validates.

Tasks marked with `*` are optional and can be skipped for a faster MVP path; the orchestrator must not implement them automatically.

## Tasks

- [x] 1. Set up project foundations
  - [x] 1.1 Initialize Next.js 14 + TypeScript project structure
    - Create the Next.js App Router project (`app/`, `lib/`, `components/`, `tests/`)
    - Configure `tsconfig.json` (strict mode), `next.config.mjs`, ESLint, Prettier, and Tailwind CSS with Radix Primitives
    - Add `package.json` scripts for `dev`, `build`, `start`, `lint`, `test`, `test:pbt`
    - Install runtime deps: `next`, `react`, `react-dom`, `@prisma/client`, `prisma`, `zod`, `react-hook-form`, `@radix-ui/react-dialog`, `sharp`, `next-auth`, `@auth/prisma-adapter`, `argon2`, `otplib`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `resend`, `@upstash/redis`
    - Install dev deps: `vitest`, `@vitest/coverage-v8`, `fast-check`, `@playwright/test`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `msw`
    - _Requirements: all_

  - [x] 1.2 Define core domain types and interfaces
    - Create `lib/types/domain.ts` with `Project`, `MediaItem`, `MediaRef`, `Category`, `Tag`, `Bio`, `SocialLink` per the design's Domain Models section
    - Create `lib/types/inquiry.ts` with `Inquiry`, `ReferenceImage`, `BudgetRangeOption`, `ContactSubmission`, `CommissionInquiry`, `FieldError`, `SubmissionContext`, `SubmissionResult`
    - Create `lib/types/cms.ts` with `ProjectInput`, `BioInput`, `InquiryFilter`, `InquiryPage`, `GalleryQuery`, `GalleryPageResult`, `AdminUser`, `Session`, `NotificationJob`, `DeletionTask`, `ConsentRecord`, `AuditEvent`
    - Export branded id types (`ProjectId`, `MediaItemId`, `CategoryId`, `TagId`, `InquiryId`, `AdminId`, etc.)
    - _Requirements: 1.2, 2.1, 3.1, 6.1, 7.1, 8.2, 9.2_

  - [x] 1.3 Set up Prisma schema and database migrations
    - Create `prisma/schema.prisma` with models: `Project`, `MediaItem`, `Category`, `Tag`, `ProjectTag`, `Bio`, `SocialLink`, `Inquiry`, `ReferenceImage`, `BudgetRangeOption`, `AdminUser`, `Session`, `NotificationJob`, `DeletionTask`, `AuditEvent`
    - Add the indexes from the Design's "Database schema notes": `projects(status)`, `projects(published_at DESC)`, `project_tags(tag_id)`, `unique(slug)` on projects, `inquiries(submitted_at DESC, status)`
    - Generate the initial migration and Prisma Client
    - _Requirements: 8.2, 8.5, 8.10, 9.1, 12.3_

  - [x] 1.4 Create deterministic Clock and Id abstractions
    - Add `lib/clock.ts` exporting a `Clock` interface (`now(): Date`) with `systemClock` and `fixedClock(d)` implementations for tests
    - Add `lib/ids.ts` exporting `IdGenerator` interface (`uuid(): string`) with a `cryptoIdGenerator` and a `seededIdGenerator` for tests
    - All time- and id-dependent logic in subsequent tasks must consume these via dependency injection
    - _Requirements: 6.7, 7.8, 12.4, 12.5, 12.7_

- [ ] 2. Implement validation logic (pure)
  - [ ] 2.1 Implement bio header and field validators
    - In `lib/validation/bio.ts`, implement `validateBioHeader(name, tagline)` and `validateBioInput(input)` returning either `Ok` or a list of `FieldError` with stable codes
    - _Requirements: 1.2, 5.1, 5.2, 5.3, 5.4, 8.9_

  - [ ]* 2.2 Write property test for bio header validation
    - **Property 1: Bio header validation totality**
    - **Validates: Requirements 1.2**

  - [ ] 2.3 Implement contact and commission submission validators
    - In `lib/validation/contact.ts` and `lib/validation/commission.ts`, implement Zod schemas plus `validateContactSubmission` and `validateCommissionSubmission`
    - Enforce: name 1-100, email RFC 5322 (1-254), subject 1-200 (contact), message bounds (10-5000 contact, 20-5000 commission), `projectType` enum, `budgetRangeId` is one of admin-configured ids, `targetDeadline ≥ submission date`
    - Each error carries a stable `code` (`required`, `email_invalid`, `length_min`, `length_max`, `deadline_in_past`, `enum_invalid`)
    - _Requirements: 6.1, 6.4, 7.1, 7.2, 7.5_

  - [ ]* 2.4 Write property test for inquiry submission validation
    - **Property 11: Inquiry submission validation atomicity**
    - **Validates: Requirements 6.1, 6.4, 7.1, 7.2, 7.5**

  - [ ] 2.5 Implement attachment validator
    - In `lib/validation/attachments.ts`, implement `validateAttachments(files)` returning `(accepted, rejected)` with per-file rejection reasons
    - Enforce: per-file ≤ 10 MB, mime type ∈ {jpeg, png, webp}, ≤ 5 files total, combined ≤ 50 MB
    - When the global cap is hit, accept files in submitted order until the cap is reached and reject the rest with reason `combined_size_exceeded` or `count_exceeded`
    - _Requirements: 7.6, 7.7_

  - [ ]* 2.6 Write property test for attachment validation
    - **Property 13: Attachment validation with partial rejection**
    - **Validates: Requirements 7.6, 7.7**

  - [ ] 2.7 Implement project input and publish-readiness validators
    - In `lib/validation/project.ts`, implement `validateProjectInput(p)` and `validatePublishable(p)` returning the violation set (`missing_title`, `missing_cover_media`, `no_media_items`, `missing_alt_text(mediaId)`)
    - Implement `validateSlug(slug)` matching `^[a-z0-9]+(-[a-z0-9]+)*$` with length 1-80
    - _Requirements: 8.2, 8.11, 10.3, 10.4_

  - [ ]* 2.8 Write property test for project validation
    - **Property 16: Project input and publish-readiness validation**
    - **Validates: Requirements 8.2, 8.11, 10.3, 10.4**

  - [ ] 2.9 Implement media upload validator
    - In `lib/validation/media.ts`, implement `acceptUpload(file, kind)` returning either `MediaRef` or `ValidationError` with stable codes (`unsupported_format`, `file_too_large`)
    - Enforce 100 MB ceiling and per-kind mime allowlists (image: jpeg/png/webp; video: mp4/webm; model: gltf+json/gltf-binary)
    - _Requirements: 8.3, 8.4_

  - [ ]* 2.10 Write property test for media upload validation
    - **Property 17: Media upload validation**
    - **Validates: Requirements 8.3, 8.4**

  - [ ] 2.11 Implement featured set validator
    - In `lib/validation/featured.ts`, implement `validateFeaturedIds(ids, publishedSet)` enforcing `0 ≤ |ids| ≤ 12`, distinct ids, and every id refers to a published project
    - _Requirements: 8.10_

  - [ ]* 2.12 Write property test for featured set validation
    - **Property 19: Featured set bounds and uniqueness**
    - **Validates: Requirements 8.10**

- [ ] 3. Implement gallery, landing, and project detail logic (pure)
  - [ ] 3.1 Implement gallery filter, sort, and pagination
    - In `lib/gallery/list.ts`, implement `listGallery(projects, query, pageSize=24)` returning `GalleryPageResult` with filtering by category (single) and tags (conjunctive), sort by `newest|oldest|title_asc`, page clamping with `outOfRange` flag, and `totalPages = max(1, ceil(matching / 24))`
    - Treat `query.tags` as a set (order-independent)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10, 8.7_

  - [ ]* 3.2 Write property test for gallery filter, sort, and pagination
    - **Property 3: Gallery filter, sort, and pagination**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10, 8.7**

  - [ ] 3.3 Implement landing featured selection
    - In `lib/landing/featured.ts`, implement `selectLandingFeatured(projects, configuredFeatured)` matching the design rules: configured set filtered to published in admin order (clamped to 0-8); fallback to 6 most-recent published; empty when none
    - _Requirements: 1.3, 1.6, 1.7, 1.8_

  - [ ]* 3.4 Write property test for landing featured selection
    - **Property 2: Landing featured selection**
    - **Validates: Requirements 1.3, 1.6, 1.7, 1.8**

  - [ ] 3.5 Implement project tile and detail DTO builders
    - In `lib/projects/dto.ts`, implement `buildTile(project)` (truncates title to 80, resolves category name, picks placeholder when no cover) and `buildDetailDTO(project)` (always includes labels for title/description/category/tags/creationDate/softwareUsed; preserves media order; sets `noMediaMessage` when empty)
    - _Requirements: 2.2, 2.7, 3.1, 3.2_

  - [ ]* 3.6 Write property tests for project DTOs
    - **Property 4: Project tile DTO completeness**
    - **Property 5: Project detail field rendering completeness**
    - **Validates: Requirements 2.2, 2.7, 3.1, 3.2**

  - [ ] 3.7 Implement adjacent project navigation
    - In `lib/projects/adjacent.ts`, implement `getAdjacentProjects(publishedProjects, slug)` returning `{prev, next}` against `publishedAt`-descending order with disabled flags at endpoints
    - _Requirements: 3.9_

  - [ ]* 3.8 Write property test for adjacent project navigation
    - **Property 7: Adjacent project navigation**
    - **Validates: Requirements 3.9**

  - [ ] 3.9 Implement project visibility safety helper
    - In `lib/projects/visibility.ts`, implement `getProjectBySlug(projects, slug)` and `filterPublic(projects)` so they exclude any project with `status ≠ "published"`
    - _Requirements: 3.10, 8.7, 8.8_

  - [ ]* 3.10 Write property test for project visibility
    - **Property 8: Project visibility safety**
    - **Validates: Requirements 3.10, 8.7, 8.8**

- [ ] 4. Checkpoint - validation and listing logic
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement media pipeline and delivery
  - [x] 5.1 Implement image format negotiation and variant picking
    - In `lib/media/variants.ts`, implement `chooseImageFormat(acceptHeader)` (avif > webp > original raster) and `pickVariant(variants, viewportWidth)` (smallest variant ≥ width; else largest)
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 5.2 Write property test for image content negotiation
    - **Property 9: Image content negotiation and variant selection**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ] 5.3 Implement variant builder using sharp
    - In `lib/media/build-variants.ts`, implement `buildImageVariants(ref, originalBuffer)` producing AVIF, WebP, and JPEG variants for at least mobile (≤480), tablet (481-1024), desktop (≥1025) bands without ever upscaling beyond the original width
    - URLs include the `contentHash` for immutability
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 5.4 Implement video and model preparers
    - In `lib/media/video.ts`, implement `prepareVideo(ref)` returning a `VideoManifest` with mp4 and webm sources, poster image, optional captions VTT URL, and optional transcript
    - In `lib/media/model.ts`, implement `prepareModel(ref)` returning a `ModelManifest` with the glTF/GLB URL
    - _Requirements: 3.6, 3.7, 10.8_

  - [ ] 5.5 Implement object storage adapter
    - In `lib/storage/s3.ts`, implement an `ObjectStorage` interface with `put(key, body, opts)`, `get(key)`, `delete(key)`, `signedUrl(key, ttl)` backed by the AWS SDK and configured for SSE-KMS
    - Provide an in-memory implementation for tests in `lib/storage/memory.ts`
    - _Requirements: 8.3, 8.4, 12.3_

  - [ ] 5.6 Implement responsive image lazy-load reducer
    - In `components/media/lazy-image-reducer.ts`, implement a pure reducer over states `{idle, loading, loaded, error}` and events `[enterViewport, loadStart, loadEnd, loadError, retry, timeout]` enforcing `retryCount ≤ 3`, single `loadStart` per attempt, fixed intrinsic dimensions, and 15-second timeout
    - _Requirements: 4.4, 4.6, 4.7_

  - [ ]* 5.7 Write property test for lazy-load state machine
    - **Property 10: Lazy-load and placeholder state machine**
    - **Validates: Requirements 4.4, 4.6, 4.7**

  - [ ] 5.8 Build `ResponsiveImage` component
    - In `components/media/ResponsiveImage.tsx`, render `<picture>` with avif/webp `<source>` and JPEG fallback, intrinsic width/height, `loading="lazy"`, `decoding="async"`, IntersectionObserver-driven LQIP placeholder, and a retry control wired to the reducer
    - Use IntersectionObserver with a 200 px root margin (Requirement 4.4)
    - _Requirements: 4.1, 4.4, 4.6, 4.7_

  - [ ]* 5.9 Write component test for ResponsiveImage
    - Verify lazy loading triggers within 200 px, placeholder visible until load, error indicator on timeout, layout stability (intrinsic dimensions)
    - _Requirements: 4.4, 4.6, 4.7_

- [ ] 6. Implement lightbox, video player, and 3D viewer
  - [ ] 6.1 Implement lightbox reducer
    - In `components/lightbox/reducer.ts`, implement a pure reducer with state `{open, index, actualSize}` and actions `{open(items, startIndex), close, prev, next, toggleActualSize}`, enforcing index clamping at endpoints and involutive `toggleActualSize`
    - Emit `restoreFocus(triggerId)` on close
    - _Requirements: 3.4, 3.5, 10.6, 10.7_

  - [ ]* 6.2 Write property test for lightbox reducer and viewer keyboard behaviour
    - **Property 6: Lightbox navigation and viewer keyboard behaviour**
    - **Validates: Requirements 3.4, 3.5, 10.6, 10.7**

  - [ ] 6.3 Build Lightbox component
    - In `components/lightbox/Lightbox.tsx`, wrap Radix Dialog with `aria-modal="true"`, focus trap, scroll lock, arrow-key/Escape handlers, prev/next/close/actual-size controls, and focus restoration within 200 ms
    - _Requirements: 3.3, 3.4, 3.5, 10.6, 10.7_

  - [ ]* 6.4 Write component test for Lightbox keyboard interactions
    - Tab cycles within trap, Shift+Tab cycles backwards, Escape closes and restores focus to trigger, prev/next disabled at endpoints
    - _Requirements: 3.4, 3.5, 10.6, 10.7_

  - [ ] 6.5 Build VideoPlayer component
    - In `components/video/VideoPlayer.tsx`, render `<video controls preload="metadata">` with mp4/webm sources, captions track when present, transcript disclosure, IntersectionObserver pause-when-offscreen
    - _Requirements: 3.6, 10.8_

  - [ ] 6.6 Build ModelViewer component
    - In `components/model/ModelViewer.tsx`, dynamic-import the `<model-viewer>` script only on pages with a `model3d` item, expose `camera-controls`, configure programmatic min/max zoom that keeps the model fully visible, add a keyboard-accessible reset-view control, handle Escape to return focus
    - _Requirements: 3.7, 10.6, 10.7_

  - [ ]* 6.7 Write component test for VideoPlayer and ModelViewer
    - Verify caption toggle, controls keyboard reachability, model viewer reset-view focus management
    - _Requirements: 3.6, 3.7, 10.6, 10.7, 10.8_

- [ ] 7. Implement rate limiting, captcha, and email dispatch
  - [ ] 7.1 Implement sliding-window rate limiter
    - In `lib/rate-limit/sliding-window.ts`, implement `RateLimiter` with `check(ip, key, windowSec, max, now)` and `record(ip, key, now)` using a per-key timestamp deque; eviction on access
    - Provide a Redis-backed implementation in `lib/rate-limit/redis.ts` using Upstash and an in-memory implementation for tests
    - Calls `record` only after a successful submission past validation; failed CAPTCHA still records to slow attackers
    - _Requirements: 6.7, 7.8_

  - [ ]* 7.2 Write property test for spam and rate-limit gating
    - **Property 12: Spam and rate-limit gating**
    - **Validates: Requirements 6.5, 6.6, 6.7, 7.8**

  - [ ] 7.3 Implement captcha verifier
    - In `lib/captcha/turnstile.ts`, implement `verifyCaptcha(token, clientIp)` calling Cloudflare Turnstile; on any failure return a generic `spam_blocked` error
    - Provide a deterministic mock implementation for tests
    - _Requirements: 6.5, 6.6, 7.8_

  - [ ] 7.4 Implement notification job state machine
    - In `lib/notifications/state-machine.ts`, implement a pure state machine with `attemptCount ≤ 3`, total elapsed retry time ≤ 5 min, terminal `succeeded`/`failed`, sets `inquiry.deliveryFailed = true` on failure
    - _Requirements: 6.8, 7.9_

  - [ ]* 7.5 Write property test for notification delivery state machine
    - **Property 14: Notification delivery state machine**
    - **Validates: Requirements 6.8, 7.9**

  - [ ] 7.6 Implement EmailDispatcher worker
    - In `lib/notifications/dispatcher.ts`, read `notification_jobs` from the DB, send via Resend/Postmark adapter, update `attemptCount`/`nextRunAt`/`lastError`, terminate at attempt 3
    - _Requirements: 6.2, 6.8, 7.4, 7.9_

- [ ] 8. Implement public Inquiry API and forms
  - [ ] 8.1 Implement `POST /api/inquiries` route handler
    - In `app/api/inquiries/route.ts`, parse multipart, run captcha → rate-limit → schema validation → attachment validation → persist (transactional) → enqueue notification job
    - Failed validation does not increment the rate limiter and preserves entered values in response
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 12.3_

  - [ ] 8.2 Build ContactForm component
    - In `components/forms/ContactForm.tsx`, use React Hook Form + Zod resolver for `contactSubmissionSchema`, hidden honeypot field, Turnstile widget, inline per-field errors that retain entered values, success confirmation
    - _Requirements: 6.1, 6.3, 6.4, 6.5_

  - [ ] 8.3 Build CommissionInquiryForm component
    - In `components/forms/CommissionInquiryForm.tsx`, include name/email/projectType/budgetRange/targetDeadline/description fields plus reference image uploader (≤5, ≤10 MB each, JPEG/PNG/WebP) with per-file rejection messages and partial-success preservation
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 8.4 Write integration tests for inquiry submissions
    - End-to-end tests for valid contact submission, valid commission with attachments, invalid email, oversized attachment partial rejection, captcha failure, rate-limit exceeded
    - _Requirements: 6.1-6.8, 7.1-7.9_

- [ ] 9. Implement authentication and CMS authorization
  - [ ] 9.1 Implement AuthService with TOTP MFA
    - In `lib/auth/auth.ts`, configure Auth.js Credentials provider with argon2id password verification + TOTP via `otplib`
    - HTTP-only/Secure/SameSite=Lax cookies, 8-hour idle timeout, 24-hour hard cap; rate-limit login at 5/15 min/IP; emit audit log on success
    - _Requirements: 8.1, 9.8_

  - [ ] 9.2 Implement admin authorization middleware
    - In `middleware.ts`, enforce: HTTPS redirect (301 to https preserving host/path/query), HSTS header, security headers (CSP, Referrer-Policy, X-Content-Type-Options, Permissions-Policy), and `/admin/*` requires a valid Admin session (HTML routes redirect to `/admin/login`, API routes return 401)
    - _Requirements: 8.1, 9.8, 12.2_

  - [ ]* 9.3 Write property test for HTTPS redirect
    - **Property 27: HTTPS-only redirect**
    - **Validates: Requirements 12.2**

  - [ ]* 9.4 Write property test for admin authorization invariant
    - **Property 15: Admin authorization invariant**
    - **Validates: Requirements 8.1, 9.8**

- [ ] 10. Implement CMS write operations
  - [ ] 10.1 Implement project CRUD and status transitions
    - In `lib/cms/projects.ts`, implement `createProject`, `updateProject`, `deleteProject`, `setProjectStatus`; the publish path calls `validatePublishable` first and surfaces every violation
    - On publish/unpublish, set/clear `publishedAt`, then `revalidateTag('gallery')`, `revalidatePath('/')`, `revalidatePath('/projects/{slug}')`, and enqueue sitemap rebuild
    - On delete, cascade-delete `MediaItem` rows and remove their object-storage objects
    - _Requirements: 8.2, 8.6, 8.7, 8.8, 8.11_

  - [ ] 10.2 Implement media reorder and delete
    - In `lib/cms/media.ts`, implement `reorderMedia(projectId, orderedIds)` (verifies the supplied ids equal the project's current media multiset, then writes new `ordering` values transactionally) and `deleteMedia(id)`
    - _Requirements: 8.5_

  - [ ]* 10.3 Write property test for media reorder
    - **Property 18: Media reorder preserves contents**
    - **Validates: Requirements 8.5**

  - [ ] 10.4 Implement bio save and featured set update
    - In `lib/cms/bio.ts`, implement `saveBio(input)` validating fields per the design and persisting profile image, CV (PDF ≤ 20 MB), social links, skills/software lists
    - In `lib/cms/featured.ts`, implement `setFeaturedProjects(orderedIds)` enforcing `validateFeaturedIds` and writing `featuredOrder` per project transactionally
    - _Requirements: 8.9, 8.10_

  - [ ] 10.5 Implement CMS media upload route
    - In `app/admin/projects/[id]/media/route.ts`, accept multipart uploads, call `acceptUpload`, store original via `ObjectStorage`, run `buildImageVariants` for images, persist `MediaItem` row, return DTO
    - Reject without attaching when `validateAttachments`-style or `acceptUpload` errors occur
    - _Requirements: 8.3, 8.4, 10.4_

  - [ ] 10.6 Build CMS UI surfaces
    - In `app/admin/`, build pages for: dashboard, login (credentials + TOTP step), projects list/edit, media reorder, bio editor, featured editor — using server actions for writes and Next.js form helpers
    - _Requirements: 8.1, 8.2, 8.5, 8.6, 8.9, 8.10, 8.11, 10.4_

  - [ ]* 10.7 Write integration tests for CMS write flows
    - Project create/publish/unpublish/delete, media upload + reorder, bio save, featured set update, publish-readiness validation surfaces all violations
    - _Requirements: 8.2, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11_

- [ ] 11. Implement Inquiry Management
  - [ ] 11.1 Implement inquiry listing and detail
    - In `lib/cms/inquiries.ts`, implement `listInquiries(filter, page)` with 25/page, submitted-date-descending order, conjunctive type/status filters, `emptyState` flag, and DTO truncation (name ≤ 100, email ≤ 254)
    - Implement `getInquiryDetail(id)` returning all submitted fields plus `k` attachment thumbnails with full-size links and `noAttachments` flag
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.7_

  - [ ]* 11.2 Write property tests for inquiry listing and detail
    - **Property 20: Inquiry listing — ordering, paging, filtering, DTO completeness**
    - **Property 22: Inquiry detail completeness**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.7**

  - [ ] 11.3 Implement inquiry status transition
    - In `lib/cms/inquiry-status.ts`, implement `updateInquiryStatus(id, status)` transactionally so other fields remain unchanged on success and prior status is retained on persistence failure
    - _Requirements: 9.5, 9.6_

  - [ ]* 11.4 Write property test for inquiry status transition
    - **Property 21: Inquiry status transition safety**
    - **Validates: Requirements 9.5, 9.6**

  - [ ] 11.5 Build CMS Inquiries UI
    - In `app/admin/inquiries/`, build the paginated list view (with filters), detail view (with reference image thumbnails linking to full-size), status update controls, and delivery-failure banner
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7_

- [ ] 12. Implement deletion service for inquiries
  - [ ] 12.1 Implement deletion task state machine
    - In `lib/deletion/state-machine.ts`, implement a pure state machine with `attemptCount ≤ 3`, terminal states `succeeded` and `failed-manual`, and the rule that `succeeded → pending_deletion` regression is impossible
    - _Requirements: 12.6, 12.7_

  - [ ]* 12.2 Write property test for inquiry deletion state machine
    - **Property 29: Inquiry deletion state machine**
    - **Validates: Requirements 12.6, 12.7**

  - [ ] 12.3 Implement DeletionService worker and API
    - In `lib/deletion/service.ts`, on Admin "delete inquiry": mark `status = pending_deletion`, enqueue `deletion_task`; worker removes inquiry row + reference image rows + storage objects (primary + replicas) within 24 hours with up to 3 retries
    - In `app/admin/inquiries/[id]/route.ts`, expose the `DELETE` endpoint that triggers the workflow and returns the scheduling confirmation
    - _Requirements: 12.6, 12.7_

- [ ] 13. Checkpoint - CMS, inquiries, and deletion
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Implement public pages and navigation
  - [ ] 14.1 Build LandingPage
    - In `app/page.tsx`, render artist name + tagline + featured projects via `selectLandingFeatured`; use `ResponsiveImage` for thumbnails; render the placeholder message when no featured/published projects exist
    - Provide visible, keyboard-focusable navigation links to Gallery, About, Contact (Tab traversal)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ] 14.2 Build GalleryPage
    - In `app/gallery/page.tsx`, parse `category`, `tags[]`, `sort`, `page` from search params, call `listGallery`, render grid of tiles via `buildTile`, render filter controls that reset to page 1 on change, render pagination controls with first/prev/next/last + numeric pages, render out-of-range banner and empty-state message with "clear filters" control
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [ ] 14.3 Build ProjectDetailPage
    - In `app/projects/[slug]/page.tsx`, call `getProjectBySlug`; return `notFound()` for missing or draft projects (Requirement 3.10) so 404s are byte-identical
    - Render title/description/category/tags/creationDate/softwareUsed with placeholders for missing values; iterate media in order; image → thumbnail opening Lightbox; video → VideoPlayer; model3d → ModelViewer
    - Add "Back to Gallery" control and prev/next project navigation via `getAdjacentProjects`
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [ ] 14.4 Build BioPage
    - In `app/about/page.tsx`, render biography, profile image, skills, software, social links (`target="_blank" rel="noopener noreferrer"`), and CV download; render section-level placeholder messages independently when content is missing; surface a retry control on a 10 s load failure
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ] 14.5 Build Contact and Commission pages and PrivacyPolicyPage
    - In `app/contact/page.tsx`, render `ContactForm`; in `app/commission/page.tsx`, render `CommissionInquiryForm`; in `app/privacy/page.tsx`, render the privacy policy describing categories of personal data, purposes, retention, and contact method
    - _Requirements: 6.1, 7.1, 12.1_

  - [ ] 14.6 Build Footer with privacy link
    - In `components/layout/Footer.tsx`, render a footer present on every page with a link to `/privacy`
    - _Requirements: 12.1_

- [ ] 15. Implement responsive and accessibility infrastructure
  - [ ] 15.1 Implement design tokens and contrast verification helper
    - In `lib/a11y/contrast.ts`, implement `contrastRatio(fg, bg)` (WCAG formula) and a `verifyDesignTokens(tokens)` helper that asserts body text ≥ 4.5, large text ≥ 3, focus indicator ≥ 3
    - In `app/globals.css` or token file, define the actual design tokens for foreground, background, large text, and focus ring
    - _Requirements: 10.2, 10.5_

  - [ ]* 15.2 Write property test for color contrast against design tokens
    - **Property 23: Color contrast against design tokens**
    - **Validates: Requirements 10.2, 10.5**

  - [ ] 15.3 Implement skip-to-main-content link and semantic landmarks
    - In `app/layout.tsx`, render a "skip to main content" link as the first focusable element on each page; wrap content with `<header>`, `<nav>`, `<main id="main-content">`, `<footer>` landmarks
    - _Requirements: 10.2, 10.5_

  - [ ] 15.4 Implement responsive layout tokens for 320-2560 px
    - In Tailwind config, define breakpoints covering 320, 375, 768, 1024, 1280, 1920, 2560
    - Audit landing/gallery/detail/bio/contact pages so no horizontal scroll or clipped controls occur in this range
    - _Requirements: 10.1_

  - [ ]* 15.5 Write component tests for accessibility behaviors
    - Verify keyboard tab order matches visual reading order, focus indicator visible, skip link is first focusable element, captions/transcript control reachable
    - _Requirements: 10.2, 10.5, 10.8_

- [ ] 16. Implement SEO, sitemap, and robots
  - [ ] 16.1 Implement page meta resolver
    - In `lib/seo/meta.ts`, implement `resolveMeta(page)` returning `{title, description, og:title, og:description, og:image, og:url, og:type, twitter:* }` with title 10-60, description 50-160, og/twitter mirrored, og:image ≥ 1200×630 ≤ 5 MB, and per-page uniqueness across landing/gallery/about/projects[*]
    - Per-project meta uses project title + description; provide a per-page OG image picker with fallbacks
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]* 16.2 Write property test for page meta resolver
    - **Property 24: Page meta resolver**
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [ ] 16.3 Wire metadata into Next.js pages
    - In each `app/**/page.tsx`, export `generateMetadata` that calls `resolveMeta` and returns the Next.js metadata object including Open Graph and Twitter Card tags
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ] 16.4 Implement sitemap builder and route
    - In `lib/seo/sitemap.ts`, implement `buildSitemap(projects)` returning the URL set: static public pages + every published project URL; never CMS or `/api/*` paths
    - In `app/sitemap.xml/route.ts`, serve the cached sitemap blob from object storage; rebuild via a debounced job triggered by publish/unpublish/delete events with a 5-minute deadline; on failure retain the previous valid blob and set an admin error flag
    - _Requirements: 11.4, 11.6, 11.7_

  - [ ]* 16.5 Write property tests for sitemap and rebuild workflow
    - **Property 25: Sitemap and robots correctness**
    - **Property 26: Sitemap rebuild workflow**
    - **Validates: Requirements 11.4, 11.5, 11.6, 11.7**

  - [ ] 16.6 Implement robots.txt route
    - In `app/robots.txt/route.ts`, serve a static robots policy that allows all sitemap URLs and disallows `/admin/*` and `/api/*`
    - In `lib/seo/robots.ts`, implement `isAllowedByRobots(url)` consumed by the route handler
    - _Requirements: 11.5_

- [ ] 17. Implement consent and privacy
  - [x] 17.1 Implement ConsentService
    - In `lib/consent/service.ts`, implement `getConsent()`/`setConsent(decision)` reading/writing the first-party `consent` cookie (180-day expiry); enforce that no non-essential cookies are set unless consent = "accepted"
    - _Requirements: 12.4, 12.5_

  - [ ]* 17.2 Write property test for consent-gated cookies
    - **Property 28: Consent-gated cookies**
    - **Validates: Requirements 12.4, 12.5**

  - [ ] 17.3 Build CookieConsentBanner and analytics gating
    - In `components/consent/CookieConsentBanner.tsx`, render Accept/Reject buttons only when `consent` cookie is missing AND analytics is configured; persist choice for 180 days
    - Dynamically import the analytics module only after `getConsent() = "accepted"`
    - _Requirements: 12.4, 12.5_

  - [ ] 17.4 Implement encryption-at-rest for inquiries and attachments
    - Configure pgcrypto column-level encryption for inquiry text columns (name, email, subject, message, attachment metadata) using a KMS-managed key
    - Configure SSE-KMS on the object-storage bucket for reference image objects
    - Add `lib/crypto/inquiry-cipher.ts` providing the encrypt/decrypt helpers used by `lib/cms/inquiries.ts`
    - _Requirements: 12.3_

- [ ] 18. Final wiring and integration
  - [ ] 18.1 Wire ISR revalidation tags
    - On project publish/unpublish/delete, call `revalidateTag('gallery')`, `revalidateTag('landing')`, `revalidateTag('project:{slug}')`; on bio save call `revalidateTag('bio')`
    - Annotate fetches in landing/gallery/detail/bio pages with the matching `next: { tags: [...] }` so revalidation propagates
    - _Requirements: 8.6, 8.7, 8.8, 8.10, 11.6_

  - [ ] 18.2 Wire admin error surfaces
    - In the admin dashboard, render banners for: notification delivery failures (`inquiry.deliveryFailed`), sitemap rebuild errors, and inquiries stuck in `pending_deletion` past 24 hours
    - _Requirements: 6.8, 7.9, 11.7, 12.7_

  - [ ] 18.3 Wire CSP and security headers
    - In `next.config.mjs` or middleware, set `Content-Security-Policy` (no `unsafe-inline` for scripts, allowing the CDN media origins and Turnstile), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`, and `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
    - _Requirements: 12.2_

  - [ ]* 18.4 Write end-to-end tests for critical flows
    - Visitor browses gallery → opens project → opens lightbox → closes (focus restored)
    - Visitor submits commission with valid attachments and receives confirmation
    - Admin signs in with TOTP, publishes a project, verifies it appears on landing/gallery within revalidation window
    - Admin deletes an inquiry, verifies row + objects removed
    - _Requirements: 1.1, 2.1, 3.3, 7.1, 8.6, 12.6_

- [ ] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and may be skipped for a faster MVP path; the orchestrator must not implement them automatically.
- Each task references the specific requirement clauses it implements for traceability.
- Property-based tests use `fast-check` with at least 100 iterations per property; each test is annotated with the feature name and property number from the design's "Correctness Properties" section.
- Unit tests cover boundary inputs explicitly and complement property tests; component tests cover keyboard interactions and focus management; integration/e2e tests cover wiring across server/client boundaries.
- Visual regression, performance budgets (Lighthouse), and live HTTPS smoke tests are part of the CI strategy described in the design's Testing Strategy section but fall outside the coding tasks generated here.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1", "2.3", "2.5", "2.7", "2.9", "2.11", "3.1", "3.3", "3.5", "3.7", "3.9", "5.1", "5.4", "5.5", "5.6", "6.1", "7.1", "7.3", "7.4", "12.1", "15.1", "16.1", "16.6", "17.1"] },
    { "id": 4, "tasks": ["2.2", "2.4", "2.6", "2.8", "2.10", "2.12", "3.2", "3.4", "3.6", "3.8", "3.10", "5.2", "5.3", "5.7", "6.2", "7.2", "7.5", "7.6", "9.1", "10.1", "10.2", "10.4", "12.2", "12.3", "15.2", "16.2", "16.4", "17.2", "17.4"] },
    { "id": 5, "tasks": ["5.8", "6.3", "6.5", "6.6", "8.1", "9.2", "10.3", "10.5", "11.1", "11.3", "16.3", "16.5", "17.3"] },
    { "id": 6, "tasks": ["5.9", "6.4", "6.7", "8.2", "8.3", "9.3", "9.4", "10.6", "10.7", "11.2", "11.4", "11.5", "15.3", "15.4"] },
    { "id": 7, "tasks": ["8.4", "14.1", "14.2", "14.3", "14.4", "14.5", "14.6"] },
    { "id": 8, "tasks": ["15.5", "18.1", "18.2", "18.3"] },
    { "id": 9, "tasks": ["18.4"] }
  ]
}
```
