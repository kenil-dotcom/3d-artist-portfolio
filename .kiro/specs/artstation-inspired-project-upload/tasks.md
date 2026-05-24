# Implementation Plan: ArtStation-Inspired Project Upload

## Overview

Layer five capabilities onto the existing `app/admin/(protected)/projects/[id]/edit/` editor without forking it: typed `SectionBlock` bodies, formal 3D model support (including `usdz`), in-place media replacement, AVIF/WebP variant generation, and scheduled publishing. Every task extends a file already present in the repo or adds a sibling next to it; no parallel admin route is created.

Implementation language is TypeScript, matching the rest of the Next.js 14 + Prisma codebase. Property-based tests use the already-installed `fast-check` and run under Vitest in `tests/pbt/`. Property numbers (1–12) match the "Correctness Properties" section in `design.md` exactly.

## Tasks

- [x] 1. Schema, types, and validation foundation
  - [x] 1.1 Extend Prisma schema and types for the new features
    - In `prisma/schema.prisma`, add `scheduled` to the `ProjectStatus` enum, add `Project.scheduledAt: DateTime?`, add the composite index `@@index([status, scheduledAt])`, add `MediaItem.extension: String? @db.VarChar(16)`, add `MediaItem.variantSet: Json @default("{}")`, and add the new `SectionBlockKind` enum and `SectionBlock` model with both `mediaItem` (`SectionBlockPrimary`) and `mediaItemB` (`SectionBlockSecondary`) relations plus `@@index([projectId, ordering])`.
    - In `lib/types/domain.ts`, widen `ProjectStatus` to include `'scheduled'`, widen `ModelMimeType` to include `'model/vnd.usdz+zip'`, add `Project.scheduledAt: ProjectIsoTimestamp | null`, add `MediaItem.extension: string | null` and `MediaItem.variantSet: VariantSet`, and export the new `VariantSet`, `Variant`, `VariantFailure`, `SectionBlock`, and `SectionBlockKind` types described in the design.
    - _Requirements: 1.1, 1.2, 2.4, 4.2, 6.3, 7.1, 15.1, 15.4_

  - [x] 1.2 Generate the `artstation_upload` migration with backfills
    - Run `prisma migrate dev --name artstation_upload` and inspect the generated SQL.
    - Confirm the migration performs the operations in the order listed in design.md "Migration order" (enum value, columns, backfills for `extension` and `publishedAt`, `section_blocks` table, both new indexes). If Prisma misses the backfill statements, hand-edit the migration SQL to add `UPDATE media_items SET extension = CASE mime_type ... END` and `UPDATE projects SET published_at = COALESCE(updated_at, created_at) WHERE status = 'published' AND published_at IS NULL` (the `COALESCE` fallback covers legacy rows whose `updated_at` is null).
    - Wrap every step except the enum addition (Postgres requires the `ALTER TYPE ... ADD VALUE` outside any transaction) in a single `BEGIN ... COMMIT` block so the column adds, backfills, table create, and index creates either all land or none of them do. Capture pre-migration `SELECT COUNT(*)` and `SELECT id` snapshots for `projects` and `media_items` into temp tables on the first transactional statement so the post-conditions in task 1.6 can assert against them.
    - _Requirements: 15.1, 15.2, 15.4_

  - [x] 1.3 Extend allowed-MIME constants for `usdz`
    - In `lib/validation/media.ts`, append `'model/vnd.usdz+zip'` to `ALLOWED_MODEL_MIME_TYPES` (and the union it derives from). `MAX_MEDIA_BYTES` is unchanged.
    - In `lib/admin/uploads.ts`, add `'model/vnd.usdz+zip': 'usdz'` to the `MIME_TO_EXT` map and any kind-inference table. The map is the single source of truth for the lowercase extension persisted on `MediaItem.extension`.
    - In `lib/admin/presign.ts`, confirm `inferKindFromMime` returns `'model3d'` for the new MIME without further code changes (the lookup is driven by `ALLOWED_MIME_TYPES_BY_KIND`).
    - _Requirements: 2.4, 2.5, 2.11, 15.4_

  - [ ]* 1.4 Property test for media MIME and size validators
    - **Property 1: Media MIME and size validation**
    - For all MIME strings `m` and integer sizes `s`, `requestUploadUrl` issues a presigned URL iff `m ∈ ALLOWED_IMAGE_MIME_TYPES ∪ ALLOWED_VIDEO_MIME_TYPES ∪ ALLOWED_MODEL_MIME_TYPES` AND `s ∈ (0, MAX_MEDIA_BYTES]`. Rejections carry `invalid_format` for MIME failures and `file_too_large` for size failures. The presign call is short-circuited before any R2 client construction on either rejection branch.
    - **Validates: Requirements 2.1, 2.5, 2.6**
    - File: `tests/pbt/media-validators.pbt.test.ts` using `fast-check`.

  - [x] 1.5 Install `sanitize-html` for server-side text-block sanitisation
    - Run `npm install sanitize-html` to add the runtime dep and `npm install --save-dev @types/sanitize-html` to add the type-only dev dep.
    - Add the new entries to `package.json` under `dependencies` and `devDependencies` respectively; commit `package-lock.json`. The library will be imported only from server-side modules (`lib/admin/sectionBlocks.ts` and the section-action server actions), never from a client component, so the package is excluded from the browser bundle by Next.js automatically.
    - _Requirements: 1.4, 1.14_

  - [ ]* 1.6 Migration post-condition assertions
    - In `tests/unit/migration-postconditions.test.ts`, run the `artstation_upload` migration against a freshly-seeded test database and assert that `SELECT COUNT(*) FROM projects`, `SELECT COUNT(*) FROM media_items`, the full `id` set for `projects`, and the full `id` set for `media_items` are bit-for-bit equal pre- and post-migration. Verify that a deliberately corrupted migration (e.g., a stray `DELETE FROM media_items WHERE ...`) aborts the transaction and leaves the database in its pre-migration state.
    - _Requirements: 15.1, 15.2_

- [x] 2. Pure validators and reducers for the new domains
  - [x] 2.1 Implement `lib/validation/schedule.ts`
    - Export `parseScheduledAt(input: string, now: Date): { ok: true; value: Date } | { ok: false; code: 'scheduled_at_missing' | 'scheduled_at_in_past' }`.
    - Treat empty/unparseable input as `scheduled_at_missing`. Treat any timestamp `<= now` as `scheduled_at_in_past`. Treat any timestamp `> now + 365 days` as `scheduled_at_in_past` as well — both bounds emit the same code so the user-facing remediation message is unified ("pick a closer date"). The 365-day upper bound is enforced as `now.getTime() + 365 * 86_400_000` so there is no off-by-one drift across DST.
    - Export `applyStatusTransition(prev, next, now)` that produces the canonical `(status, scheduledAt, publishedAt)` triple per Requirement 7.5–7.6. `next === 'draft'` ⇒ both timestamps null. `next === 'published'` ⇒ `scheduledAt = null`, `publishedAt = prev.publishedAt ?? now`. `next === 'scheduled'` ⇒ `scheduledAt` carries the parsed timestamp, `publishedAt` is left as-is.
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 2.2 Property test for schedule validation and status transitions
    - **Property 2: Schedule parser bounds and status transitions**
    - For all timestamps `t` and `now`, `parseScheduledAt(t.toISOString(), now)` is `ok` iff `t > now AND t <= now + 365 days`. For all `(prevStatus, nextStatus)` pairs, the transition triple satisfies: `nextStatus === 'draft' ⇒ scheduledAt === null && publishedAt === null`; `nextStatus === 'published' ⇒ scheduledAt === null && (publishedAt unchanged when non-null else now)`; `nextStatus === 'scheduled' ⇒ scheduledAt !== null && scheduledAt > now && scheduledAt <= now + 365 days`.
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6**
    - File: `tests/pbt/schedule.pbt.test.ts`.

  - [x] 2.3 Implement `lib/admin/sectionBlocks.ts`
    - Export `validateAddBlock(input, project, mediaIndex)` and `validateUpdateBlock(input, project, mediaIndex)` returning `Result<SectionBlock, { code: 'block_media_required' | 'block_media_mismatch' | 'block_kind_mismatch' | 'block_image_pair_duplicate_media' | 'invalid_text_body' | 'block_limit_exceeded' }>` per the kind table in design.md.
    - For media-bearing kinds (`image`, `image_pair`, `video`, `model3d`) the validator MUST first check that the required reference (or both references for `image_pair`) is supplied and non-empty. A null/empty reference rejects with `block_media_required` before any database lookup runs (Requirement 1.18). `block_media_mismatch` and `block_kind_mismatch` are reserved for the case where an id is supplied but resolves to a row on the wrong project or of the wrong kind.
    - For the `text` kind, sanitise `body` server-side using `sanitize-html` (imported from the dep added in task 1.5) with the allow-list `{ allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'], allowedAttributes: { a: ['href'] }, allowedSchemes: ['https'] }`. Trim the sanitised result; reject empty results or strings exceeding 10 000 characters with `invalid_text_body`. Sanitisation runs even when the client is also sanitising — the server is the only trust boundary.
    - Export `enforceBlockLimit(projectId, currentCount)` (or fold into `validateAddBlock`) that rejects with `block_limit_exceeded` when the count of existing Section_Blocks for the Project is `>= 200` (Requirement 1.19). The check is performed inside the same transaction as the insert in task 6.1 so the cap holds under concurrent adds.
    - Export `renumberBlocks(blocks: ReadonlyArray<SectionBlock>): ReadonlyArray<SectionBlock>` that renumbers `ordering` to a contiguous `0..N-1` sequence preserving the input's index order.
    - Export `appendBlock(blocks, newBlock)` that places the new block at `ordering = blocks.length`.
    - Export `validateImagePairDistinct(input)` (rejects with `block_image_pair_duplicate_media` when `mediaItemId === mediaItemBId`).
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.14, 1.15, 1.18, 1.19_

  - [ ]* 2.4 Property test for section-block ordering reducers
    - **Property 3: Section_Block ordering reducers preserve contiguous sequences**
    - For any `blocks` with arbitrary integer orderings, `renumberBlocks(blocks)` returns a permutation of the same ids whose `ordering` values are exactly `0..N-1` in input index order. For any `blocks` and any `newBlock`, `appendBlock(blocks, newBlock).at(-1).ordering === blocks.length`. Removing any single block followed by `renumberBlocks` always yields a contiguous `0..N-2` sequence.
    - **Validates: Requirements 1.3, 1.9, 1.10**
    - File: `tests/pbt/section-blocks-ordering.pbt.test.ts`.

  - [ ]* 2.5 Property test for section-block kind/media matching
    - **Property 4: Section_Block kind/media matching is total**
    - For any `(blockKind, mediaKind, projectMatch)` tuple drawn from the cross product, `validateAddBlock` accepts iff `blockKind === 'text'` (no media required, body well-formed) OR `(blockKind === 'image' ∧ mediaKind === 'image' ∧ projectMatch)` OR `(blockKind === 'image_pair' ∧ both refs are image-kind ∧ projectMatch ∧ ids distinct)` OR `(blockKind === 'video' ∧ mediaKind === 'video' ∧ projectMatch)` OR `(blockKind === 'model3d' ∧ mediaKind === 'model3d' ∧ projectMatch)`. For any media-required block kind saved without the required reference, the validator returns `block_media_required`. For any project with 200 existing Section_Blocks, the validator rejects new adds with `block_limit_exceeded`. Foreign `projectId` always rejects with `block_media_mismatch`.
    - **Validates: Requirements 1.5, 1.6, 1.7, 1.8, 1.11, 1.12, 1.18, 1.19**
    - File: `tests/pbt/section-blocks-kinds.pbt.test.ts`.

  - [x] 2.6 Implement publish-readiness validator extension
    - Extend `lib/validation/project.ts` `validatePublishable(project)` to evaluate every rule in Requirement 8 against the candidate Project without short-circuiting and to additionally check that every `SectionBlock` references a Media_Item that exists in `project.mediaItems` and matches the block's kind (`block_reference_broken`). Define `RULE_ORDER` as the constant `['missing_title', 'invalid_slug', 'missing_category', 'missing_cover', 'no_media', 'missing_alt_text', 'block_reference_broken']` and filter the failing-codes set against `RULE_ORDER` so duplicate detections collapse and output ordering is stable across calls.
    - Return shape stays the existing `{ ok: true } | { ok: false; missing: ReadonlyArray<PublishReadinessCode> }` envelope where `missing` is a distinct, `RULE_ORDER`-ordered union. Callers (`saveProject`, `publishProject`, `scheduleProject`) MUST treat `{ ok: false }` as a no-op for state — they do not write any column to the persisted Project on the rejection branch.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [ ]* 2.7 Property test for publish-readiness aggregation
    - **Property 5: Publish-readiness aggregates the distinct union of failures**
    - For any synthesised `Project`, `validatePublishable(project).missing` equals the distinct union of `RULE_ORDER` codes whose precondition is violated, ordered by `RULE_ORDER` index. The validator is idempotent: running it twice on the same project yields equal results. On rejection, no column on the project snapshot is mutated (the validator is pure).
    - **Validates: Requirements 8.1, 8.9**
    - File: `tests/pbt/publish-readiness.pbt.test.ts`.

  - [x] 2.8 Implement software-list normaliser
    - Add `normalizeSoftwareList(input: ReadonlyArray<string>): { ok: true; value: ReadonlyArray<string> } | { ok: false; code: 'too_many_software_entries' | 'invalid_software_entry' }` to `lib/validation/project.ts`.
    - Trim entries; reject empty, >60 chars, or >20 entries; deduplicate case-insensitively while preserving the first occurrence's casing and order.
    - Wire it into `saveProject` so duplicate / oversize lists are caught before persistence.
    - _Requirements: 11.3, 11.4, 11.5, 11.6_

  - [ ]* 2.9 Property test for software-list normalisation
    - **Property 6: Software-list normaliser is idempotent and order-preserving**
    - For any `xs: string[]`, when `normalizeSoftwareList(xs)` returns `ok`, `normalizeSoftwareList(value).value === value` (idempotent). The output preserves the order and casing of each first-seen case-insensitive entry. Output length never exceeds input length and never exceeds 20.
    - **Validates: Requirements 11.3, 11.4, 11.5, 11.6**
    - File: `tests/pbt/software-list.pbt.test.ts`.

  - [x] 2.10 Implement metadata normaliser for alt text and caption
    - Add `normalizeAltText(input: string): string | null` and `normalizeCaption(input: string): string | null` helpers in `lib/validation/media.ts`.
    - Both helpers strip leading and trailing characters from the Unicode whitespace categories `space` (U+0020), `tab` (U+0009), `CR` (U+000D), and `LF` (U+000A) only — non-ASCII whitespace such as U+00A0 and U+2028 is preserved so authors can use them deliberately. The trim regex is `/^[\u0020\u0009\u000D\u000A]+|[\u0020\u0009\u000D\u000A]+$/g`.
    - Return `null` when the trimmed result is the empty string. Otherwise clamp to 500 characters for `normalizeAltText` and 200 characters for `normalizeCaption`.
    - Replace the inline trim/slice in `updateMediaItem` (in `app/admin/(protected)/projects/[id]/edit/actions.ts`) with these helpers.
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [~]* 2.11 Property test for alt-text / caption normalisation
    - **Property 7: Alt-text and caption normalisation**
    - For any input string `s`, `normalizeAltText(s)` returns `null` iff `s.trim().length === 0` after stripping the Unicode whitespace categories space / tab / CR / LF; otherwise returns a string of length `≤ 500` equal to the trimmed prefix. The function is idempotent under repeated application. The same property holds for `normalizeCaption` with bound 200.
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**
    - File: `tests/pbt/metadata-normalisers.pbt.test.ts`.

- [x] 3. Variant generation pipeline
  - [x] 3.1 Implement `lib/admin/variants.ts`
    - Export `planVariantWidths(originalWidth: number): ReadonlyArray<number>` that returns a subset of `[400, 800, 1600, 2400]` skipping widths exceeding `originalWidth * 1.1`.
    - Export `generateVariants(input: { mediaId, sourceBuffer, originalWidth }, deps: { put(key, body, contentType): Promise<{ url: string; byteSize: number }> })` that runs the sharp pipeline per width × `{avif, webp}`, writes each rendition to `variants/{mediaId}/{width}.{ext}` via the injected `put`, and returns a `VariantSet` recording successes and per-rendition `VariantFailure` entries (each caught individually so one bad encoder does not lose the others).
    - For each `(width, format)` rendition, run up to **3 attempts** (initial plus 2 retries) before recording the failure. The retry budget aligns with the per-file upload retry budget in Requirement 13.4 / 13.5.
    - Truncate every recorded `cause` string to at most 200 characters via `cause.slice(0, 200)` before persisting (Requirement 6.7). Truncation is unconditional — even short causes pass through `slice(0, 200)` so the bound is enforced uniformly.
    - Use `pipeline.toBuffer()` for sources `≤ 32 MB` and `pipeline.toFile(tmpdir())` for larger sources (per design "Variant generation pipeline").
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7_

  - [ ]* 3.2 Property test for variant width planner
    - **Property 8: Variant width planner never upscales and is monotone**
    - For any `originalWidth ≥ 0`, `planVariantWidths(originalWidth)` is a subset of `[400, 800, 1600, 2400]`, contains no width `w` such that `w > originalWidth * 1.1`, and is monotonically ordered ascending.
    - **Validates: Requirements 6.1, 6.2**
    - File: `tests/pbt/variant-widths.pbt.test.ts`.

  - [ ]* 3.3 Unit test for partial-failure resilience and cause truncation
    - In `tests/unit/variants.test.ts`, mock the `put` dependency so it throws for one specific `(width, format)` pair and assert that `generateVariants` still returns the remaining renditions plus a `failures` entry recording the cause. Verify the cause string is truncated to ≤ 200 chars even when the underlying sharp error message is longer. Verify that exactly 3 attempts are made for the failing rendition before it is recorded as failed.
    - _Requirements: 6.4, 6.7_

  - [x] 3.4 Wire variant generation into `finalizeUpload`
    - In `app/admin/(protected)/projects/[id]/edit/upload-actions.ts`, before any `prisma.mediaItem.create` for image kinds, run a strict dimension probe via sharp on the just-uploaded R2 object. If sharp throws or returns non-positive integer width or height, call the R2 client to delete the uploaded object at the presigned `publicUrl` and return `{ ok: false, code: 'invalid_format' }` without ever creating a Media_Item row (Requirement 2.10). The Media_Item row only becomes visible to the Media_Manager listing once positive integer width and height are persisted (Requirement 2.9).
    - For every kind (image, video, model3d) persist the lowercase file extension on the row using the `MIME_TO_EXT` map. For model3d uploads the persisted value is exactly one of `glb`, `gltf`, `usdz` (Requirement 2.11). Apply `.toLowerCase()` defensively before write so any future map entry stays compliant.
    - For image kinds, after the row is created, fetch the original bytes once, pass them to `generateVariants`, and `prisma.mediaItem.update({ where: { id }, data: { variantSet } })`.
    - Return the updated `FinalizedMediaItem` shape including `variantSet` and `extension` fields.
    - _Requirements: 2.7, 2.9, 2.10, 2.11, 6.3_

  - [x] 3.5 Add cleanup helper for variant keys
    - In `lib/admin/variants.ts`, export `deleteVariantKeys(mediaId: string, deps: { remove(key): Promise<void> })` that lists and removes every `variants/{mediaId}/*` object. Used by the replace-file action and by `deleteMediaItem`.
    - Wire it into `deleteMediaItem` in `app/admin/(protected)/projects/[id]/edit/actions.ts` so deleting a Media_Item no longer leaves orphan variant objects (Requirement 6.8). The call runs inside the same Prisma transaction as the row delete so a failure to clean up R2 still rolls back the row delete and surfaces an actionable error.
    - _Requirements: 4.4, 6.8_

- [ ] 4. In-place media replacement
  - [~] 4.1 Implement `replaceMediaFile` server action
    - Add `replaceMediaFile(mediaId, publicUrl, contentType, contentLength, filename)` to `app/admin/(protected)/projects/[id]/edit/upload-actions.ts`.
    - Steps: (1) `requireAdmin()`. (2) Load the existing row. (3) Compare `inferKindFromMime(contentType)` to the existing `MediaItem.kind` — when they differ, return `{ ok: false, code: 'kind_change_disallowed' }` immediately and **do not** mutate the row, **do not** invalidate the Variant_Set, **do not** delete any object from R2, **do not** call sharp (Requirement 4.3). The just-uploaded orphan object at `publicUrl` is left to the bucket lifecycle rule. (4) Inside a single Prisma transaction, update `storageKey`, `contentHash`, `mimeType`, `byteSize`, `width`, `height`, `extension` while preserving `id`, `projectId`, `altText`, `caption`, `ordering`. (5) **Always** invalidate the prior Variant_Set by writing `variantSet = { renditions: [], failures: [] }` and calling `deleteVariantKeys(mediaId)` regardless of new kind, so leftover renditions never serve stale bytes (Requirement 4.4). (6) Regenerate variants via `generateVariants` **only** when the new `kind === 'image'` — video and model3d replacements skip the sharp pipeline entirely (Requirement 4.4 / 4.5). (7) Call `revalidateProjectPaths(slug)` so the next public request to `/projects/{slug}` returns the new file (Requirement 4.5).
    - **Upload-failure rollback semantics.** If the browser's PUT to the new presigned URL fails or times out (the same 600-second / non-2xx envelope used for fresh uploads), the client never invokes `replaceMediaFile` and the existing row remains exactly as it was. If `replaceMediaFile` itself throws after step 4 has committed, the action returns `{ ok: false, code: 'upload_failed' }`; the variant-set invalidation in step 5 has already cleared `variantSet` so the renderer falls back to the original `storageKey` rendering per Requirement 6.6 — the user-visible failure mode is "no responsive variants yet" rather than a broken row.
    - Return the same `FinalizeUploadResult` envelope used by `finalizeUpload`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [~] 4.2 Wire "Replace file" affordance into `ProjectMediaManager`
    - In `components/admin/ProjectMediaManager.tsx`, add a "Replace file" control to each `SortableMediaRow` that opens a hidden `<input type="file">` scoped to that row. On selection, run the existing presign → PUT → finalize flow but call `replaceMediaFile(mediaId, ...)` instead of `finalizeUpload`. Show per-row progress using the existing `QueuedFile` machinery, keyed by `mediaId` so it does not collide with the global queue.
    - On success, replace the row in `items` with the returned record (preserving its position) so alt text and caption stay visible without a refresh.
    - On `kind_change_disallowed`, render the error inline against the row and confirm in-DOM that the row's pre-replace data is still rendered unchanged (no optimistic mutation on the rejection branch).
    - _Requirements: 4.1, 4.2, 4.3, 13.1_

  - [~]* 4.3 Property test for replacement preservation
    - **Property 10: Replace preserves identity and rejects kind changes without mutation**
    - For any pre-existing `MediaItem` `m` and any replacement payload `p` with the same kind, `replaceMediaFile(m.id, p)` returns a record where `id`, `projectId`, `altText`, `caption`, `ordering` equal `m`'s and `storageKey`, `contentHash`, `mimeType`, `byteSize`, `extension` equal `p`'s, and the prior `Variant_Set` is invalidated to `{ renditions: [], failures: [] }`. For any `(m, p)` with differing kinds, the action returns `{ ok: false, code: 'kind_change_disallowed' }` and the database row is byte-identical to `m` (no mutation, no variant invalidation, no R2 delete).
    - **Validates: Requirements 4.2, 4.3, 4.4**
    - File: `tests/pbt/media-replace.pbt.test.ts` using a fake Prisma adapter.

- [ ] 5. Reorder hardening and embed validation
  - [x] 5.1 Add explicit error codes to `reorderMediaList`
    - In `app/admin/(protected)/projects/[id]/edit/upload-actions.ts`, change the existing string errors to a `{ ok: false; error: string; code: 'unknown_media_id' | 'reorder_count_mismatch' | 'reorder_duplicate_id' }` shape so the client can branch on `code`.
    - Detect duplicates in the supplied id list before any database write: build `new Set(orderedIds)` and reject with `reorder_duplicate_id` when `set.size !== orderedIds.length`. The duplicate check is performed inside the same transaction as the count and ownership checks so all three rejections happen before any row is mutated.
    - Verify the two-pass renumber inside the existing transaction still produces a contiguous `0..N-1` sequence.
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [ ]* 5.2 Property test for reorder reducer
    - **Property 9: Media reorder respects the input permutation**
    - For any list of project media with ids `S` and any permutation `P` of `S`, applying `reorderMediaList(projectId, P)` yields a database state where `media[i].ordering === i` and `media.find(m => m.ordering === i).id === P[i]`. For any list `Q ≠ S` (foreign id present) `reorderMediaList` returns `{ ok: false, code: 'unknown_media_id' }` and leaves the state unchanged. For any list whose length differs from `|S|`, returns `{ ok: false, code: 'reorder_count_mismatch' }`. For any list with a duplicate id, returns `{ ok: false, code: 'reorder_duplicate_id' }`.
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
    - File: `tests/pbt/media-reorder.pbt.test.ts` using a fake Prisma client that records writes.

  - [x] 5.3 Tighten embed parser to enforce HTTPS and supported provider
    - In `lib/admin/embeds.ts`, ensure `parseEmbedUrl(url)` returns `null` for any of the following: empty input after trimming, length > 2048 characters, any URL that does not parse, any non-HTTPS scheme, any host not on the allowlist `['youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com', 'www.vimeo.com', 'player.vimeo.com']` after normalisation, or any URL whose provider id-extraction regex does not match.
    - On success the parser returns `{ provider, embedUrl, thumbnailUrl }` where `embedUrl` always begins with `https://` and `provider` is a member of the allowlist. `thumbnailUrl` is non-null only when the provider exposes one.
    - In `addYouTubeEmbed` (rename internally to `addEmbed` if convenient, keep the export name for source compatibility), surface the result as `{ ok: false; code: 'unsupported_embed_provider' }` instead of a free-text error. On success persist `kind = video`, `embedUrl = parsed.embedUrl`, `byteSize = 0` always (Requirement 9.3 / 9.4), and `storageKey = parsed.thumbnailUrl ?? null` so providers without thumbnails persist `storageKey = null` (Requirement 9.4).
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 5.4 Property test for embed URL acceptance
    - **Property 11: Embed parser only accepts HTTPS YouTube and Vimeo URLs**
    - For any URL string `u`, `parseEmbedUrl(u)` returns non-null only when `u` is non-empty, at most 2048 characters, parses as a `URL`, has scheme `https:`, and has a hostname on the YouTube/Vimeo allowlist. The returned `embedUrl` always begins with `https://` and the returned provider is a member of the allowlist. Embed Media_Items always carry `byteSize === 0` and carry `storageKey === null` exactly when the resolved provider exposes no thumbnail.
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
    - File: `tests/pbt/embed-url.pbt.test.ts`.

  - [~] 5.5 Client-side reorder hardening (debounce + abort timeout)
    - In `components/admin/ProjectMediaManager.tsx`, debounce the reorder submission to **500 ms** after the last drop using a single trailing `setTimeout`. Within the debounce window the local `items` array is the source of truth so consecutive drops collapse into a single network round trip (Requirement 3.1).
    - Wrap the submission `fetch` / server-action call in an `AbortController` configured with a **10-second** timeout. On timeout, abort the in-flight request, revert the local `items` state to the pre-drop snapshot, and surface the error against the row anchor.
    - On any rejection (`unknown_media_id`, `reorder_count_mismatch`, `reorder_duplicate_id`, or the abort timeout), revert the optimistic order to the pre-drop snapshot. On success the optimistic order is already correct; no flicker.
    - Apply the same debounce + abort timing inside `components/admin/ProjectSectionEditor.tsx` (task 6.3) so both reorder surfaces share the 500 ms / 10 s envelope.
    - _Requirements: 3.1, 3.6, 3.7_

- [~] 6. Section-block server actions and admin UI
  - [x] 6.1 Implement `app/admin/(protected)/projects/[id]/edit/section-actions.ts`
    - Export `addSectionBlock(projectId, kind, payload)`, `updateSectionBlock(blockId, patch)`, `removeSectionBlock(blockId)`, `reorderSectionBlocks(projectId, orderedIds)` server actions.
    - Each calls `requireAdmin()`, validates the input through `lib/admin/sectionBlocks.ts` (which now runs the `sanitize-html` pass for `text` bodies and the 200-block cap check), and runs multi-row writes inside a single Prisma transaction. `addSectionBlock` runs `prisma.sectionBlock.count({ where: { projectId } })` inside the transaction and rejects with `block_limit_exceeded` when the count is `>= 200` (Requirement 1.19).
    - `reorderSectionBlocks` mirrors `reorderMediaList`: rejects with `unknown_block_id` (Requirement 1.16) when any supplied id does not belong to the target Project, with `reorder_count_mismatch` (Requirement 1.17) when the count mismatches, and with `reorder_duplicate_id` when the supplied list contains a duplicate id. All rejections happen before any row is mutated. Use the same two-pass shift used by `reorderMediaList`. Remove and update both call `renumberBlocks` so the persisted ordering remains contiguous.
    - Save / update emit `block_media_required`, `block_media_mismatch`, `block_kind_mismatch`, `block_image_pair_duplicate_media`, `invalid_text_body`, or `block_limit_exceeded` per the kind table in design.md.
    - Return the `Result<T, { code }>` envelope shape from design.md "Action result envelopes".
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 12.1_

  - [~] 6.2 Wire revalidation into section-block actions with non-blocking warnings
    - On every successful section-block mutation, call `revalidatePath('/admin/projects')`, `revalidatePath('/gallery')`, `revalidatePath('/')`, and `revalidatePath('/projects/' + slug)` (load the slug in the same transaction). Reuse the existing `revalidateProjectPaths` helper by exporting it from `app/admin/(protected)/projects/[id]/edit/actions.ts`.
    - Wrap every individual `revalidatePath` call in a try/catch. Accumulate any failures into a `revalidationWarnings: ReadonlyArray<string>` field on the action's `Result.value` envelope (each entry shaped as `${path}: ${reason}`). The persisted mutation is **not** rolled back when a revalidation fails — the database state is the canonical source of truth, and a failed revalidation only delays the public surface from picking up the change until the next ISR window (Requirement 14.5).
    - Surface `revalidationWarnings` in the admin client as a non-blocking warning banner rendered at the top of the editor so admins see which path failed without losing the success indication.
    - _Requirements: 14.1, 14.2, 14.3, 14.5_

  - [~] 6.3 Build `components/admin/ProjectSectionEditor.tsx`
    - Client component rendered inside `app/admin/(protected)/projects/[id]/edit/page.tsx` directly under the `ProjectMediaManager` section.
    - Props: `projectId`, `slug`, `description`, `mediaItems` (already loaded by the page), `initialBlocks: ReadonlyArray<SectionBlock>`.
    - Renders an ordered list of blocks with `@dnd-kit/sortable` powered drag handles (mirroring `ProjectMediaManager`'s setup). Per-block inline editor switches on `kind`: textarea for `text`; media-picker `<select>` filtered to image/video/model3d Media_Items belonging to the project for the other kinds; two pickers for `image_pair`.
    - "Add block" toolbar exposes the five kinds. New blocks call `addSectionBlock` then append to local state. When the server returns `block_limit_exceeded`, render the rejection inline against the toolbar and disable the "Add block" affordance until a block is removed.
    - Reorder dispatch uses the same **500 ms debounce** + **10 s `AbortController` timeout** as `ProjectMediaManager` (task 5.5). On timeout or any rejection (`unknown_block_id`, `reorder_count_mismatch`, `reorder_duplicate_id`) revert the local order to the pre-drop snapshot.
    - When `initialBlocks.length === 0` and `description.trim().length > 0`, render a virtual seed `text` block sourced from `description`. Persist the seed only when the admin saves any block in the editor for the first time (Requirement 1.13 / 15.5).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.13, 1.16, 1.17, 1.19, 3.1, 3.6, 3.7, 15.5_

  - [~] 6.4 Mount the section editor on the edit page
    - In `app/admin/(protected)/projects/[id]/edit/page.tsx`, fetch `prisma.sectionBlock.findMany({ where: { projectId }, orderBy: { ordering: 'asc' } })` alongside the existing `mediaItems` fetch and pass the result into `ProjectSectionEditor`.
    - Section appears as a new `<section aria-labelledby="sections-heading">` between the existing media block and the danger-zone block.
    - _Requirements: 1.1, 1.13_

  - [ ]* 6.5 Component test for the seed-block behaviour
    - In `tests/unit/project-section-editor-seed.test.tsx` (new), mount `ProjectSectionEditor` with `initialBlocks: []` and a non-empty `description`, assert one `text` block renders with that body, then assert the seed is *not* persisted until the user submits a save. Use `@testing-library/react`.
    - _Requirements: 1.13, 15.5_

- [ ] 7. Schedule UI and cron
  - [~] 7.1 Widen the status field in `ProjectEditorForm`
    - In `components/admin/ProjectEditorForm.tsx`, replace the two-state Draft/Published chip group inside `StatusField` with a tri-state Draft / Scheduled / Published group. When `Scheduled` is active, render an `<input type="datetime-local" name="scheduledAt">` with a `min` set to `now + 1 minute` and a `max` set to `now + 365 days` so the browser-side validator catches the bound before the server.
    - The hidden `status` field continues to drive submission; add a hidden `scheduledAt` field that mirrors the datetime input. When the admin switches away from `Scheduled`, clear the field locally so it round-trips correctly.
    - _Requirements: 7.1, 7.2_

  - [~] 7.2 Extend `saveProject` to honour scheduled status
    - In `app/admin/(protected)/projects/[id]/edit/actions.ts`, parse `scheduledAt` from the form, call `parseScheduledAt(scheduledAt, new Date())` from `lib/validation/schedule.ts`, and surface `scheduled_at_in_past` (covering both the past timestamp and the >365-day-future timestamp) and `scheduled_at_missing` per Requirements 7.3 / 7.4. On rejection, leave the previously stored Project values unchanged — no column is written on the rejection branch.
    - Use `applyStatusTransition` to compute the canonical `(status, scheduledAt, publishedAt)` triple. Persist the triple per Requirement 7.5 / 7.6. Run the publish-readiness validator on transitions to either `scheduled` or `published`; on `{ ok: false }` from the validator, leave persisted state unchanged and surface the `RULE_ORDER`-ordered union of failing codes (Requirement 8.1).
    - Update the create branch in `app/admin/(protected)/projects/new/actions.ts` to forbid `scheduled` (creation always starts as `draft`, matching today's behaviour).
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 8.1_

  - [~] 7.3 Build the cron route at `app/api/cron/publish-scheduled/route.ts`
    - Export a `GET` handler that asserts `Authorization: Bearer ${process.env.CRON_SECRET}` (the header Vercel injects into cron invocations). On a missing header, malformed header, or token mismatch, respond with HTTP 401 and never read or mutate any `projects` row (Requirement 7.11). Compare the supplied bearer to the configured secret using `crypto.timingSafeEqual` over equal-length `Buffer`s — pad / reject mismatched lengths before the comparison so the timing-safe compare never throws.
    - Run a **single transactional update** that promotes every due Project in one round trip: `UPDATE projects SET status = 'published', published_at = COALESCE(published_at, NOW()), scheduled_at = NULL WHERE status = 'scheduled' AND scheduled_at <= NOW() RETURNING id, slug;` Use `prisma.$queryRaw` so the `RETURNING` clause executes in one round trip and the multi-row promotion happens atomically.
    - Iterate the returned `(id, slug)` pairs and call `revalidatePath('/projects/' + slug)` for each, then call `revalidatePath('/gallery')` and `revalidatePath('/')` once at the end of the loop. Each `revalidatePath` is wrapped in try/catch — a failure for one slug is logged with the path and reason and the loop continues to the next slug, so a single bad slug does not block the rest (Requirement 7.8). The handler awaits every revalidation before returning so any request received after the response returns the newly published Project (Requirement 7.12).
    - Add a `vercel.json` cron entry pointing at `/api/cron/publish-scheduled` with the agreed cadence (`*/1 * * * *` on Pro, `*/5 * * * *` on Hobby — start with the latter and document the upgrade).
    - _Requirements: 7.7, 7.8, 7.11, 7.12, 14.1, 14.2, 14.3_

  - [ ]* 7.4 Unit test for the cron promotion query
    - In `tests/unit/cron-publish-scheduled.test.ts`, stub Prisma to return a list of promoted rows; assert the route called `revalidatePath` once per slug, `/gallery` once, and `/` once. Assert that an empty result set is a no-op (no `revalidatePath` calls at all). Assert that a request with a missing or mismatched `Authorization` header returns HTTP 401 and that the stubbed Prisma `$queryRaw` is never invoked. Assert that when one slug's `revalidatePath` rejects, the route still revalidates the remaining slugs.
    - _Requirements: 7.7, 7.8, 7.11, 7.12_

  - [x] 7.5 Filter scheduled rows out of public queries
    - Audit `lib/content/api.ts` (`listPublishedProjects`, `getProjectBySlug`, the gallery query) and confirm every public read filters on `status = 'published'` rather than `!= 'draft'`. Tighten any query that uses the latter so `scheduled` rows never leak to `/gallery` or `/projects/[slug]`.
    - _Requirements: 7.9, 7.10_

  - [ ]* 7.6 Unit test for public-query filtering
    - In `tests/unit/scheduled-not-public.test.ts`, seed in-memory rows in three states and assert `listPublishedProjects()` returns only the `published` row and `getProjectBySlug` returns `null` for both `draft` and `scheduled` slugs.
    - _Requirements: 7.9, 7.10_

- [~] 8. Public renderer updates for variants and 3D models
  - [~] 8.1 Update `ResponsiveImage` to consume `VariantSet`
    - In `components/media/ResponsiveImage.tsx`, accept an optional `variantSet?: VariantSet` prop. When `variantSet.renditions.length > 0`, emit a `<picture>` element with `<source type="image/avif" srcset=...>`, `<source type="image/webp" srcset=...>`, and the original `<img src={storageKey}>` as the final fallback. When the prop is absent or `renditions` is empty (legacy rows or in-flight generation), fall back to the existing single-source `<img>` rendering of `storageKey` (Requirement 6.6).
    - Build the `srcset` strings as `<storageKey> <width>w` joined by commas, sorted ascending by width.
    - _Requirements: 6.5, 6.6_

  - [~] 8.2 Render section blocks on the public detail page
    - In `app/projects/[slug]/page.tsx`, fetch the project's `sectionBlocks` ordered by `(ordering ASC, createdAt ASC)` so deterministic rendering survives the rare tie when two blocks share the same `ordering` mid-reorder (Requirement 16.1). When `sectionBlocks.length > 0`, render a new `SectionBlockRenderer` switch beneath the hero. When the array is empty fall back to rendering `Project.description` per Requirement 16.2.
    - `SectionBlockRenderer` switches on `block.kind`:
      - `text`: render sanitised HTML inside a prose container; if the trimmed body is empty, skip the block without raising an error (Requirement 16.4); cap rendered length at 20 000 characters.
      - `image`: render `<ResponsiveImage>` with the referenced Media_Item's `variantSet`. Skip the block when the referenced row is missing or has no `storageKey` (Requirement 16.12).
      - `image_pair`: render a CSS grid using `@media (min-width: 768px)` for two columns and a single stacked column below 768 px (Requirement 16.6). Partial-availability degradation: when exactly one of the two referenced Media_Items is missing or has no `storageKey`, render the surviving image as a single-column figure with the missing slot omitted, no visitor-facing error (Requirement 16.7). When both are missing, return `null` and continue rendering subsequent blocks (Requirement 16.12).
      - `video`: reuse the existing HTML5 `<video>` / iframe rule (Requirement 16.8); skip on missing reference.
      - `model3d`: look up `mediaItem.extension`, lower-case it via `extension?.toLowerCase()`, and switch — `glb` or `gltf` → `<model-viewer src={storageKey} ar camera-controls auto-rotate>` (Requirement 16.9); `usdz` → render an Apple AR Quick Look anchor `<a rel="ar" href={storageKey}><img src={posterStorageKey} alt={altText} /></a>` so iOS Safari surfaces the AR badge (Requirement 16.10), and when no poster is available wrap a plain text label inside the anchor; any other extension → return `null` (Requirement 16.11). Extension matching is case-insensitive throughout — the only comparison key is the lowercased value.
      - On any unrenderable block (missing reference, empty text body, unknown extension) return `null` from the switch and continue rendering subsequent blocks (Requirement 16.12).
    - Add the `<script type="module" src="https://unpkg.com/@google/model-viewer@latest/dist/model-viewer.min.js"></script>` once at the page level **only when** at least one model3d block resolves to a renderable Media_Item, so visitors do not pay the script cost on text-only case studies. Document the CSP allowlist requirement in a comment (`script-src` and `connect-src` for the unpkg origin).
    - _Requirements: 1.1, 1.2, 6.5, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12_

  - [ ]* 8.3 Component test for the picture-element fallback
    - In `tests/unit/responsive-image-variants.test.tsx`, render `<ResponsiveImage>` with and without `variantSet`. Assert: with renditions, two `<source>` elements are present in the order avif → webp; without renditions (or with `renditions: []`), only the bare `<img src={storageKey}>` is rendered.
    - _Requirements: 6.5, 6.6_

  - [ ]* 8.4 Component test and property test for the section-block renderer
    - In `tests/unit/section-block-renderer-skip.test.tsx`, mount `SectionBlockRenderer` with: a `text` block whose body is whitespace only (asserted skipped); an `image` block whose Media_Item is absent (asserted skipped, subsequent blocks still rendered); an `image_pair` block with one missing slot (asserted single-column rendering of survivor); a `model3d` block with `extension = 'GLB'` (asserted `<model-viewer>` rendered, demonstrating case-insensitive matching); a `model3d` block with `extension = 'usdz'` (asserted `<a rel="ar">` rendered); a `model3d` block with `extension = 'fbx'` (asserted skipped).
    - In `tests/pbt/section-block-renderer.pbt.test.ts`:
      - **Property 12: Public renderer skips unrenderable blocks and continues**
      - For all lists of Section_Blocks `bs` rendered against a Media_Item index `idx`, the renderer's output preserves the relative order of the renderable subset and omits every block whose primary Media_Item is missing or whose `model3d` extension (case-insensitive) is not in `{glb, gltf, usdz}`. For all `image_pair` blocks with exactly one missing slot, the output renders the surviving image as a single-column figure and never raises an error to the visitor.
      - **Validates: Requirements 16.1, 16.7, 16.9, 16.10, 16.11, 16.12**
    - _Requirements: 16.1, 16.4, 16.6, 16.7, 16.9, 16.10, 16.11, 16.12_

- [~] 9. Checkpoint - Ensure all tests pass
  - Run `npm run typecheck`, `npm run lint`, `npm run test`. Ensure every property and unit test introduced in tasks 1–8 passes. Ask the user if questions arise.

- [ ] 10. UX polish and per-row error surfacing
  - [~] 10.1 Per-file retry / cancel / progress surface
    - Confirm `ProjectMediaManager`'s existing `QueuedFile` state covers Requirements 13.2–13.7 and harden where needed:
      - **Per-file retry budget**: each queued file allows up to 3 attempts (initial plus 2 retries). After the third failure the file is marked `permanently_failed`, the "Retry" affordance is hidden, the final failure reason is retained next to the row, and no Media_Item row is ever created for it (Requirement 13.4 / 13.5).
      - **Cancel-abort assertion**: "Cancel" calls `xhr.abort()` on the in-flight `XMLHttpRequest` and the component asserts (via a `Date.now()` check around the `abort()` call) that the abort completes within **1 second**; the file is removed from the queue and `finalizeUpload` is never invoked for it (Requirement 13.6).
      - **Progress cadence**: while a file is in `uploading` status, subscribe to the XHR `progress` event and additionally force a `setState` tick every **500 ms** via `setInterval` cleared on completion, so the displayed integer percentage in `[0, 100]` updates at least every 500 ms even when the network goes quiet between progress events (Requirement 13.7).
    - Surface errors inline against the row anchor; section-level banner only for errors that cannot be attributed to a specific row (Requirement 13.1 / 13.2). Include the per-row replace error rendering introduced in task 4.2 on the same surface.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [~] 10.2 Auto-clear cover when the cover Media_Item is deleted
    - Confirm `setCoverMedia` and `deleteMediaItem` cooperate so deleting a Media_Item that is currently `coverMediaId` flips `Project.coverMediaId` to `null`. Schema-level `onDelete: SetNull` already covers this; add an integration test that exercises the round trip and asserts the gallery thumbnail disappears after the same-request `revalidatePath` (Requirement 5.5).
    - _Requirements: 5.5_

  - [ ]* 10.3 Unit test for cover-clear on delete
    - In `tests/unit/cover-media-cleanup.test.ts`, set `coverMediaId` to a known media id, delete it, then assert `Project.coverMediaId` is `null` after revalidation.
    - _Requirements: 5.5_

  - [~] 10.4 Auto-set cover on first image upload and harden setCoverMedia rejections
    - Verify `ProjectMediaManager.runQueue` already calls `setCoverMediaSilent` when the project has no cover and the new item is image-kind (Requirement 5.4). Move the corresponding server-side check into `setCoverMedia` so the action remains the source of truth and refuses non-image items with `cover_must_be_image` and foreign items with `cover_not_in_project` and missing items with the explicit `cover_media_not_found` code.
    - On every rejection branch (`cover_must_be_image`, `cover_not_in_project`, `cover_media_not_found`), `Project.coverMediaId` is left exactly as it was — no column write occurs on the rejection path. Add an assertion in the action and a test that exercises each branch and confirms the persisted `coverMediaId` is byte-identical pre- and post-call.
    - On the auto-set path during `finalizeUpload`, the action calls `setCoverMediaSilent` (a server-internal variant of `setCoverMedia` that bypasses the user-facing rejection codes) inside the same transaction as the row insert when the parent Project has `coverMediaId IS NULL` and the new item is image-kind. The trigger is positional — the first image-kind Media_Item to land on the Project, regardless of earlier non-image uploads (Requirement 5.4).
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 11. Slug-rename revalidation
  - [~] 11.1 Revalidate both old and new slug paths on rename
    - In `saveProject`, after the update, call `revalidateProjectPaths(oldSlug)` and `revalidateProjectPaths(newSlug)` whenever `oldSlug !== newSlug`. The current code already calls both helpers; harden by extracting the comparison and adding a dedicated test.
    - _Requirements: 14.4_

  - [ ]* 11.2 Unit test for old + new slug revalidation
    - In `tests/unit/save-project-slug-rename.test.ts`, spy on `revalidatePath` and assert both `/projects/{old}` and `/projects/{new}` are revalidated when the slug changes; only one path is revalidated when the slug is unchanged.
    - _Requirements: 14.4_

- [~] 12. Final checkpoint - Ensure all tests pass
  - Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Ensure the full test suite is green and the production build succeeds. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery; they cover property-based and component tests.
- Every task references the specific requirement clauses it satisfies for traceability.
- Property tests live under `tests/pbt/` and use the already-installed `fast-check` library; they are run by `npm run test:pbt`. Property numbers (1–12) align exactly with the "Correctness Properties" section of `design.md`.
- The implementation extends the existing admin pages and components in place rather than introducing new routes — there is exactly one editor at `/admin/projects/[id]/edit` after this feature ships.
- `sanitize-html` is the only new runtime dependency; it is imported only from server-side modules so it never enters the browser bundle.
- The cron route is the only new HTTP endpoint introduced; it is gated by the `CRON_SECRET` Vercel injects via constant-time bearer comparison and never reads cookies.

## Property summary

| # | Title | Requirements | Test file |
| --- | --- | --- | --- |
| 1 | Media MIME and size validation | 2.1, 2.5, 2.6 | `tests/pbt/media-validators.pbt.test.ts` |
| 2 | Schedule parser bounds and status transitions | 7.2, 7.3, 7.4, 7.5, 7.6 | `tests/pbt/schedule.pbt.test.ts` |
| 3 | Section_Block ordering reducers preserve contiguous sequences | 1.3, 1.9, 1.10 | `tests/pbt/section-blocks-ordering.pbt.test.ts` |
| 4 | Section_Block kind/media matching is total | 1.5, 1.6, 1.7, 1.8, 1.11, 1.12, 1.18, 1.19 | `tests/pbt/section-blocks-kinds.pbt.test.ts` |
| 5 | Publish-readiness aggregates the distinct union of failures | 8.1, 8.9 | `tests/pbt/publish-readiness.pbt.test.ts` |
| 6 | Software-list normaliser is idempotent and order-preserving | 11.3, 11.4, 11.5, 11.6 | `tests/pbt/software-list.pbt.test.ts` |
| 7 | Alt-text and caption normalisation | 10.1, 10.2, 10.3, 10.4 | `tests/pbt/metadata-normalisers.pbt.test.ts` |
| 8 | Variant width planner never upscales and is monotone | 6.1, 6.2 | `tests/pbt/variant-widths.pbt.test.ts` |
| 9 | Media reorder respects the input permutation | 3.2, 3.3, 3.4, 3.5 | `tests/pbt/media-reorder.pbt.test.ts` |
| 10 | Replace preserves identity and rejects kind changes without mutation | 4.2, 4.3, 4.4 | `tests/pbt/media-replace.pbt.test.ts` |
| 11 | Embed parser only accepts HTTPS YouTube and Vimeo URLs | 9.1, 9.2, 9.3, 9.4 | `tests/pbt/embed-url.pbt.test.ts` |
| 12 | Public renderer skips unrenderable blocks and continues | 16.1, 16.7, 16.9, 16.10, 16.11, 16.12 | `tests/pbt/section-block-renderer.pbt.test.ts` |

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.5"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.1", "2.3", "2.8", "2.10", "3.1", "5.3"] },
    { "id": 2, "tasks": ["1.6", "2.2", "2.4", "2.5", "2.9", "2.11", "3.2", "3.3", "5.4", "8.1"] },
    { "id": 3, "tasks": ["2.6", "3.4", "3.5", "5.1", "6.1", "7.5"] },
    { "id": 4, "tasks": ["2.7", "4.1", "5.2", "5.5", "6.2", "7.1", "7.6", "8.3", "10.4", "11.1"] },
    { "id": 5, "tasks": ["4.2", "6.3", "7.2", "10.1", "10.2", "11.2"] },
    { "id": 6, "tasks": ["4.3", "6.4", "7.3", "10.3"] },
    { "id": 7, "tasks": ["6.5", "7.4", "8.2"] },
    { "id": 8, "tasks": ["8.4"] }
  ]
}
```
