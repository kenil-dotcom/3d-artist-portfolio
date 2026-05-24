# Requirements Document

## Introduction

This feature evolves the existing project editor at `app/admin/(protected)/projects/[id]/edit/` into an ArtStation-inspired project upload and authoring experience for the 3D-artist portfolio. The current editor already supports presigned direct-to-R2 uploads, drag-and-drop reorder, YouTube and Vimeo embeds, alt-text and caption editing, cover selection, and a publish-readiness checklist. This feature builds on that foundation and adds the capabilities a 3D-focused artist needs to assemble a polished case-study page in one place: a structured section-block body, scheduled publishing, in-place media replacement, responsive image variants, and explicit support for `glb`, `gltf`, and `usdz` 3D model previews.

The scope is limited to the admin authoring flow and the data needed to render the resulting project on the existing public detail page at `app/projects/[slug]`. Public-side renderer changes are explicitly called out where they are required to consume the new data; the broader public site redesign is out of scope.

## Glossary

- **Project_Editor**: The admin UI at `/admin/projects/[id]/edit` that lets the Admin author and publish a single Project.
- **Project**: The `projects` row plus its joined `media_items`, `project_tags`, category, software list, and section blocks.
- **Media_Item**: A row in `media_items`. Either a stored asset (image, video, or 3D model file) or an external embed (YouTube, Vimeo).
- **Cover_Media**: The single Media_Item referenced by `Project.coverMediaId` and used as the gallery thumbnail on `/gallery` and the preview image in social meta.
- **Section_Block**: A typed unit inside a Project's body. Five kinds: `text`, `image`, `image_pair`, `video`, `model3d`. Each has a stable position within the Project.
- **Media_Manager**: The client component that lets the Admin upload, embed, replace, reorder, edit metadata for, and delete Media_Items.
- **Section_Editor**: The client component that lets the Admin add, reorder, edit, and remove Section_Blocks.
- **Upload_Pipeline**: The presigned-PUT direct-to-R2 flow comprising `requestUploadUrl` and `finalizeUpload` in `app/admin/(protected)/projects/[id]/edit/upload-actions.ts`, plus the R2 client in `lib/admin/presign.ts`.
- **Image_Variant_Generator**: The server-side process that derives responsive renditions of an uploaded image (e.g., `400w`, `800w`, `1600w`, `2400w`, AVIF and WebP) and stores them alongside the original in R2.
- **Variant_Set**: The map of derived renditions (width plus format plus storage URL) for a single image Media_Item.
- **Embed_Provider**: A supported third-party video host. Allowed providers: YouTube, Vimeo.
- **Project_Status**: One of `draft`, `scheduled`, `published`. Replaces the current two-value enum.
- **Scheduled_At**: The UTC timestamp at which a `scheduled` Project transitions to `published`.
- **Publish_Worker**: The server process or scheduled route that promotes `scheduled` Projects whose `scheduledAt` has elapsed.
- **Publish_Readiness_Checklist**: The set of must-pass conditions before a Project may transition to `published` or `scheduled` (title set, slug set, category set, cover image set, at least one Media_Item, every image has alt text, every Section_Block well-formed).
- **Public_Renderer**: The Next.js server components and client wrappers that render public pages, principally `app/projects/[slug]/page.tsx`, `app/gallery/page.tsx`, and `components/media/ResponsiveImage.tsx`.
- **Admin**: An authenticated user with the `admin` role; access is gated by `requireAdmin()` in `lib/auth/middleware.ts`.
- **Allowed_Image_Mime**: One of `image/jpeg`, `image/png`, `image/webp`.
- **Allowed_Video_Mime**: One of `video/mp4`, `video/webm`.
- **Allowed_Model_Mime**: One of `model/gltf+json`, `model/gltf-binary`, `model/vnd.usdz+zip`.
- **Max_File_Bytes**: The per-file byte ceiling enforced by the validator. Currently 5 GB (`MAX_MEDIA_BYTES` in `lib/validation/media.ts`).
- **Cron_Secret**: The shared bearer token Vercel injects into scheduled cron invocations via the `Authorization` header, sourced from the `CRON_SECRET` environment variable.

## Requirements

### Requirement 1: Section-block project body

**User Story:** As an Admin authoring a case study, I want to compose a project page from typed Section_Blocks rather than a single description field, so that I can interleave narrative text with images, image pairs, videos, and 3D models the way ArtStation case studies are structured.

#### Acceptance Criteria

1. THE Project_Editor SHALL persist Section_Blocks as ordered rows associated with a single Project.
2. THE Project_Editor SHALL support Section_Blocks of kinds `text`, `image`, `image_pair`, `video`, and `model3d`.
3. WHEN the Admin adds a Section_Block, THE Section_Editor SHALL append the new block at position N where N equals the count of existing Section_Blocks for the Project.
4. WHEN the Admin saves a `text` Section_Block, THE Section_Editor SHALL trim leading and trailing whitespace from the body and persist the trimmed value as sanitized HTML.
5. WHEN the Admin saves an `image` Section_Block, THE Section_Editor SHALL require a reference to exactly one image-kind Media_Item belonging to the same Project.
6. WHEN the Admin saves an `image_pair` Section_Block, THE Section_Editor SHALL require references to exactly two image-kind Media_Items belonging to the same Project.
7. WHEN the Admin saves a `video` Section_Block, THE Section_Editor SHALL require a reference to exactly one video-kind Media_Item belonging to the same Project.
8. WHEN the Admin saves a `model3d` Section_Block, THE Section_Editor SHALL require a reference to exactly one model3d-kind Media_Item belonging to the same Project.
9. WHEN the Admin reorders Section_Blocks via drag-and-drop, THE Section_Editor SHALL persist the new ordering as a contiguous integer sequence starting at 0 for the affected Project.
10. WHEN the Admin removes a Section_Block, THE Section_Editor SHALL renumber the remaining Section_Blocks of that Project so their orderings remain a contiguous integer sequence starting at 0.
11. IF a Section_Block references a Media_Item id that does not exist or that does not belong to the Project, THEN THE Section_Editor SHALL reject the save with the error code `block_media_mismatch`.
12. IF a Section_Block has a kind that does not match the kind of its referenced Media_Item, THEN THE Section_Editor SHALL reject the save with the error code `block_kind_mismatch`.
13. WHERE the existing `Project.description` field is non-empty for a Project that has no Section_Blocks, THE Project_Editor SHALL render the description as a single seed `text` Section_Block when the Admin first opens the Section_Editor for that Project.
14. IF the Admin saves a `text` Section_Block whose body is empty after trimming or whose body length exceeds 10000 characters, THEN THE Section_Editor SHALL reject the save with the error code `invalid_text_body`.
15. IF the Admin saves an `image_pair` Section_Block whose two Media_Item references resolve to the same Media_Item id, THEN THE Section_Editor SHALL reject the save with the error code `block_image_pair_duplicate_media`.
16. IF a Section_Block reorder request includes a Section_Block id that does not belong to the target Project, THEN THE Section_Editor SHALL reject the reorder with the error code `unknown_block_id` and SHALL NOT mutate any row.
17. IF the count of Section_Block ids supplied to a reorder request does not equal the count of existing Section_Blocks for the target Project, THEN THE Section_Editor SHALL reject the reorder with the error code `reorder_count_mismatch` and SHALL NOT mutate any row.
18. IF the Admin saves a Section_Block of kind `image`, `image_pair`, `video`, or `model3d` without supplying the required Media_Item reference or references, THEN THE Section_Editor SHALL reject the save with the error code `block_media_required`.
19. IF the Admin attempts to add a Section_Block when the Project already has 200 Section_Blocks, THEN THE Section_Editor SHALL reject the add with the error code `block_limit_exceeded`.

### Requirement 2: Multi-format media uploads with explicit 3D model support

**User Story:** As an Admin uploading work-in-progress and final renders, I want to upload images, videos, and 3D model previews directly to storage, so that the public site can show interactive previews without my having to convert files manually.

#### Acceptance Criteria

1. WHEN the Admin selects one or more files in the Media_Manager and the file's reported size is a finite positive integer less than or equal to Max_File_Bytes (5 GB) and the file's reported MIME is in Allowed_Image_Mime, Allowed_Video_Mime, or Allowed_Model_Mime, THE Upload_Pipeline SHALL request exactly one presigned PUT URL per file before any file bytes leave the browser.
2. WHEN the file's reported MIME is in Allowed_Image_Mime, THE Upload_Pipeline SHALL classify the resulting Media_Item with `kind = image`.
3. WHEN the file's reported MIME is in Allowed_Video_Mime, THE Upload_Pipeline SHALL classify the resulting Media_Item with `kind = video`.
4. WHEN the file's reported MIME is in Allowed_Model_Mime, THE Upload_Pipeline SHALL classify the resulting Media_Item with `kind = model3d`.
5. IF the file's reported MIME is not in Allowed_Image_Mime, Allowed_Video_Mime, or Allowed_Model_Mime, THEN THE Upload_Pipeline SHALL reject the upload with the error code `invalid_format`, SHALL NOT issue a presigned URL, SHALL NOT create a Media_Item row, and SHALL surface an error indicating the rejected file name and that its format is not supported.
6. IF the file's reported size exceeds Max_File_Bytes (5 GB) or is not a finite positive integer, THEN THE Upload_Pipeline SHALL reject the upload with the error code `file_too_large`, SHALL NOT issue a presigned URL, SHALL NOT create a Media_Item row, and SHALL surface an error indicating the rejected file name and the Max_File_Bytes limit.
7. WHEN the browser PUT to R2 completes successfully with a 2xx response, THE Upload_Pipeline SHALL create exactly one Media_Item row whose `storageKey` is the public URL returned by the presign response and whose `kind` matches the classification from criteria 2 through 4.
8. IF the browser PUT to R2 does not complete successfully within 600 seconds of issuing the presigned URL, or returns a non-2xx response, THEN THE Upload_Pipeline SHALL reject the upload with the error code `upload_failed`, SHALL NOT create a Media_Item row, and SHALL surface an error indicating the rejected file name and that the upload did not complete.
9. WHEN the Upload_Pipeline creates a new Media_Item with `kind = image`, THE Upload_Pipeline SHALL probe the uploaded object for intrinsic width and height in pixels and persist both as positive integers on the Media_Item row before the row becomes visible to the Media_Manager listing.
10. IF the Upload_Pipeline cannot determine intrinsic width and height for a newly uploaded image Media_Item, THEN THE Upload_Pipeline SHALL reject the upload with the error code `invalid_format`, SHALL delete the uploaded object from storage, and SHALL NOT create a Media_Item row.
11. WHEN the Upload_Pipeline creates a new Media_Item with `kind = model3d`, THE Upload_Pipeline SHALL persist the lowercase file extension on the Media_Item, where the persisted value is exactly one of `glb`, `gltf`, or `usdz`, so the Public_Renderer can choose the correct viewer.

### Requirement 3: Drag-and-drop media reorder

**User Story:** As an Admin assembling a project page, I want to drag media items into the order I want them shown, so that the gallery and section pickers reflect that ordering without my hand-editing positions.

#### Acceptance Criteria

1. WHEN the Admin drops a Media_Item at a new position in the Media_Manager, THE Media_Manager SHALL submit the new ordered id list to the server within one user gesture.
2. WHEN the server receives a reorder request, THE Upload_Pipeline SHALL verify that every supplied Media_Item id belongs to the target Project before persisting any change.
3. IF any supplied Media_Item id does not belong to the target Project, THEN THE Upload_Pipeline SHALL reject the reorder with the error code `unknown_media_id` and SHALL NOT mutate any row.
4. IF the count of supplied Media_Item ids does not equal the count of existing Media_Items for the target Project, THEN THE Upload_Pipeline SHALL reject the reorder with the error code `reorder_count_mismatch` and SHALL NOT mutate any row.
5. WHEN the reorder request is valid, THE Upload_Pipeline SHALL atomically rewrite each Media_Item's `ordering` so the persisted values form a contiguous integer sequence starting at 0 in the supplied order.
6. WHILE the reorder request is in flight, THE Media_Manager SHALL render the optimistic order locally so the Admin sees no flicker on success.
7. IF the reorder request fails, THEN THE Media_Manager SHALL revert to the pre-drop ordering and surface the error message returned by the server.

### Requirement 4: In-place media replacement

**User Story:** As an Admin replacing a draft render with the final version, I want to swap the file behind an existing Media_Item without losing its alt text, caption, position, or section references, so that I do not have to rewire every Section_Block when I update an asset.

#### Acceptance Criteria

1. WHEN the Admin invokes "Replace file" on an existing Media_Item, THE Media_Manager SHALL prompt for a new file and submit it through the same Upload_Pipeline used for new uploads.
2. WHEN the replacement upload finalizes, THE Upload_Pipeline SHALL update the existing Media_Item row with the new `storageKey`, `contentHash`, `mimeType`, `byteSize`, `width`, `height`, and `extension` values while preserving its `id`, `projectId`, `altText`, `caption`, and `ordering`.
3. IF the replacement file's `kind` differs from the existing Media_Item's `kind`, THEN THE Upload_Pipeline SHALL reject the replacement with the error code `kind_change_disallowed` and SHALL NOT mutate the row.
4. WHEN a Media_Item is successfully replaced, THE Upload_Pipeline SHALL invalidate prior Variant_Sets for that Media_Item and regenerate them per Requirement 6 if the new `kind` is `image`.
5. WHEN a Media_Item is successfully replaced, THE Upload_Pipeline SHALL revalidate the public project path so visitors load the new file on the next request.
6. WHEN a Media_Item is successfully replaced, THE Upload_Pipeline SHALL preserve every existing Section_Block reference to the Media_Item by its `id` without modification.

### Requirement 5: Cover image selection and gallery thumbnail

**User Story:** As an Admin curating my gallery, I want to choose which image represents a project on the gallery grid, so that visitors see the most representative still even when the project's first uploaded asset is not the strongest one.

#### Acceptance Criteria

1. THE Project_Editor SHALL allow the Admin to set Cover_Media to any image-kind Media_Item that belongs to the same Project.
2. IF the Admin attempts to set Cover_Media to a Media_Item whose `kind` is not `image`, THEN THE Project_Editor SHALL reject the request with the error code `cover_must_be_image`.
3. IF the Admin attempts to set Cover_Media to a Media_Item that does not belong to the Project, THEN THE Project_Editor SHALL reject the request with the error code `cover_not_in_project`.
4. WHEN no Cover_Media is set on a Project and the Admin uploads the first image-kind Media_Item, THE Project_Editor SHALL automatically set Cover_Media to that Media_Item.
5. WHEN a Media_Item that is currently Cover_Media is deleted, THE Project_Editor SHALL clear `Project.coverMediaId` to null.

### Requirement 6: Responsive image variants

**User Story:** As a visitor on a slow connection, I want the public site to serve appropriately sized images for my screen, so that pages load quickly and I do not download a 24-megapixel hero on a phone.

#### Acceptance Criteria

1. WHEN the Upload_Pipeline finalizes a new image-kind Media_Item, THE Image_Variant_Generator SHALL produce a Variant_Set containing AVIF and WebP renditions at target widths 400, 800, 1600, and 2400 pixels.
2. THE Image_Variant_Generator SHALL skip target widths that exceed the original image's intrinsic width by more than 10 percent so it never upscales.
3. WHEN every variant in a Variant_Set has been written to storage, THE Image_Variant_Generator SHALL persist the Variant_Set on the Media_Item row, recording each rendition's storage URL, format, width, and height.
4. IF a single rendition fails to generate, THEN THE Image_Variant_Generator SHALL retain the renditions that succeeded and SHALL record the failure cause for the failed rendition without rolling back the Media_Item itself.
5. THE Public_Renderer SHALL emit a `<picture>` element or a `<source>`-bearing `<img>` for image Media_Items whose Variant_Set is non-empty so that the browser can choose the smallest acceptable rendition.
6. WHERE a Media_Item has no Variant_Set yet (legacy rows or in-flight generation), THE Public_Renderer SHALL fall back to rendering the original `storageKey` as a single `<img>` source.
7. WHEN the Image_Variant_Generator records a rendition failure cause, THE Image_Variant_Generator SHALL truncate the cause string to at most 200 characters before persisting it.
8. WHEN a Media_Item is deleted, THE Image_Variant_Generator SHALL remove every persisted Variant rendition from storage so no orphan objects remain in R2.

### Requirement 7: Project status with scheduled publishing

**User Story:** As an Admin announcing a new piece on a known date, I want to schedule a project to publish at a future timestamp, so that the project goes live without my needing to be at a computer at the moment of release.

#### Acceptance Criteria

1. THE Project_Editor SHALL treat `draft`, `scheduled`, and `published` as the only valid values for Project_Status and SHALL reject any save whose `status` field is not one of those three values with an error indicating an invalid status.
2. WHEN the Admin saves a Project with `status = scheduled`, THE Project_Editor SHALL require a `scheduledAt` UTC timestamp that is strictly later than the server time at the moment of save and no more than 365 days after that server time.
3. IF the Admin saves a Project with `status = scheduled` and a `scheduledAt` timestamp at or before the server time at the moment of save, THEN THE Project_Editor SHALL reject the save with the error code `scheduled_at_in_past` and SHALL leave the previously stored Project values unchanged.
4. IF the Admin saves a Project with `status = scheduled` and a missing or unparseable `scheduledAt`, THEN THE Project_Editor SHALL reject the save with the error code `scheduled_at_missing` and SHALL leave the previously stored Project values unchanged.
5. WHEN the Admin saves a Project with `status = published`, THE Project_Editor SHALL clear `scheduledAt` to null, SHALL set `publishedAt` to the current server time when `publishedAt` is null, and SHALL leave `publishedAt` unchanged when it is already a non-null timestamp.
6. WHEN the Admin saves a Project with `status = draft`, THE Project_Editor SHALL clear `scheduledAt` to null and SHALL clear `publishedAt` to null.
7. WHEN the Publish_Worker is invoked and identifies a Project whose `status = scheduled` and whose `scheduledAt` is at or before the current server time, THE Publish_Worker SHALL set that Project's `status` to `published`, SHALL set `publishedAt` to the current server time when `publishedAt` is null, SHALL leave `publishedAt` unchanged when it is already a non-null timestamp, and SHALL clear `scheduledAt` to null, all within the same invocation.
8. WHEN the Publish_Worker is invoked and identifies more than one Project whose `status = scheduled` and whose `scheduledAt` is at or before the current server time, THE Publish_Worker SHALL apply the transition defined in criterion 7 to every such Project within the same invocation and SHALL continue processing the remaining due Projects when the transition for any individual Project fails.
9. THE public listing query at `/gallery` SHALL exclude every Project whose `status` is not `published`.
10. THE public detail page at `/projects/[slug]` SHALL return HTTP 404 for every Project whose `status` is not `published`.
11. IF the Publish_Worker is invoked without an `Authorization: Bearer <Cron_Secret>` header whose token matches the configured Cron_Secret exactly, THEN THE Publish_Worker SHALL respond with HTTP 401 and SHALL NOT read or modify any Project row.
12. WHEN the Publish_Worker transitions a Project from `scheduled` to `published`, THE Publish_Worker SHALL revalidate the cached responses for `/projects/{slug}`, `/gallery`, and `/` before the invocation completes, so any request received after the invocation completes returns the newly published Project.

### Requirement 8: Publish-readiness gate

**User Story:** As an Admin, I want the publish action to be blocked until my project meets a minimum quality bar, so that I cannot accidentally release a half-finished case study to the public site.

#### Acceptance Criteria

1. WHEN the Admin attempts to transition a Project to `published` or `scheduled`, THE Project_Editor SHALL evaluate the Publish_Readiness_Checklist before persisting the transition.
2. IF `Project.title` is empty after trimming, THEN THE Project_Editor SHALL reject the transition with the error code `missing_title`.
3. IF `Project.slug` does not match the slug pattern in `lib/validation/project.ts`, THEN THE Project_Editor SHALL reject the transition with the error code `invalid_slug`.
4. IF `Project.categoryId` is empty, THEN THE Project_Editor SHALL reject the transition with the error code `missing_category`.
5. IF `Project.coverMediaId` is null, THEN THE Project_Editor SHALL reject the transition with the error code `missing_cover`.
6. IF the Project has zero Media_Items, THEN THE Project_Editor SHALL reject the transition with the error code `no_media`.
7. IF any image-kind Media_Item on the Project has an empty or null `altText` after trimming, THEN THE Project_Editor SHALL reject the transition with the error code `missing_alt_text`.
8. IF any Section_Block references a Media_Item that has been deleted or does not belong to the Project, THEN THE Project_Editor SHALL reject the transition with the error code `block_reference_broken`.
9. THE Project_Editor SHALL surface the union of failing error codes in a single response so the Admin sees every blocker at once rather than fixing them one at a time.

### Requirement 9: Embedded video support

**User Story:** As an Admin, I want to drop a YouTube or Vimeo URL into the Media_Manager, so that I can include process videos and breakdowns without re-encoding and re-uploading them to my own storage.

#### Acceptance Criteria

1. WHEN the Admin submits a URL to the embed input, THE Media_Manager SHALL validate that the URL is non-empty, no longer than 2048 characters, well-formed, uses the HTTPS scheme, and resolves to a supported Embed_Provider (YouTube or Vimeo), and SHALL create a Media_Item with `kind = video` and a non-null `embedUrl` only when every validation step passes.
2. IF the submitted URL is empty, exceeds 2048 characters, is not a well-formed URL, does not use the HTTPS scheme, or does not resolve to a supported Embed_Provider, THEN THE Media_Manager SHALL reject the submission with the error code `unsupported_embed_provider`, SHALL NOT create a Media_Item, and SHALL return an error response indicating that the embed URL is unsupported.
3. WHEN an embed Media_Item is created and the resolved Embed_Provider exposes a thumbnail URL, THE Media_Manager SHALL set `storageKey` to that thumbnail URL and SHALL set `byteSize` to 0 to mark the row as non-stored.
4. IF an embed Media_Item is created and the resolved Embed_Provider does not expose a thumbnail URL, THEN THE Media_Manager SHALL set `storageKey` to null and SHALL set `byteSize` to 0 to mark the row as non-stored.
5. WHEN the Public_Renderer encounters a Media_Item with `kind = video` and a non-null `embedUrl`, THE Public_Renderer SHALL render an iframe whose source is the `embedUrl` and SHALL NOT render an HTML5 `<video>` element for that Media_Item.

### Requirement 10: Per-item metadata editing

**User Story:** As an Admin building an accessible portfolio, I want to edit alt text and captions on every Media_Item, so that screen-reader users get meaningful descriptions and visitors see the captions I authored.

#### Acceptance Criteria

1. THE Media_Manager SHALL allow the Admin to set `altText` on any Media_Item up to 500 characters.
2. THE Media_Manager SHALL allow the Admin to set `caption` on any Media_Item up to 200 characters.
3. WHEN the Admin saves alt text or caption, THE Project_Editor SHALL trim leading and trailing whitespace before persisting.
4. WHEN the Admin saves alt text or caption equal to the empty string after trimming, THE Project_Editor SHALL persist null in that column rather than the empty string.

### Requirement 11: Software, tags, and category metadata

**User Story:** As an Admin, I want to record which software I used and tag a project with discipline-specific categories, so that visitors can filter the gallery by the tools and types of work that interest them.

#### Acceptance Criteria

1. THE Project_Editor SHALL allow the Admin to assign exactly one Category to each Project.
2. THE Project_Editor SHALL allow the Admin to assign zero or more Tags to each Project from the `tags` table.
3. THE Project_Editor SHALL allow the Admin to record between 0 and 20 software entries on each Project, each entry between 1 and 60 characters after trimming.
4. WHEN the Admin saves a software list with duplicate entries after case-insensitive comparison, THE Project_Editor SHALL deduplicate the list before persisting while preserving the first occurrence's casing and order.
5. IF the Admin saves a software list with more than 20 entries, THEN THE Project_Editor SHALL reject the save with the error code `too_many_software_entries`.
6. IF the Admin saves a software entry whose trimmed length is 0 or greater than 60, THEN THE Project_Editor SHALL reject the save with the error code `invalid_software_entry`.

### Requirement 12: Authorization

**User Story:** As the site owner, I want every project mutation to require an authenticated admin session, so that anonymous visitors cannot upload, modify, reorder, or delete content.

#### Acceptance Criteria

1. WHEN a server action in the Project_Editor or Upload_Pipeline is invoked to create, read, update, reorder, or delete a Project, Media_Item, or storage URL, THE server action SHALL invoke `requireAdmin()` before performing any such read or write.
2. IF `requireAdmin()` rejects the caller, THEN THE server action SHALL return a result that contains no Project, Media_Item, or storage URL data and includes an error indication that authorization failed.
3. IF a caller has not passed `requireAdmin()`, THEN THE Upload_Pipeline SHALL NOT issue a presigned PUT URL and SHALL return an error indication that authorization failed.
4. IF `requireAdmin()` rejects the caller, THEN THE Project_Editor and Upload_Pipeline SHALL leave any persisted Project, Media_Item, and object-storage state unchanged.

### Requirement 13: Error handling and feedback

**User Story:** As an Admin, I want a clear, immediate signal when an upload or save fails, so that I know which file or field to fix without searching the network tab.

#### Acceptance Criteria

1. WHEN a server action returns an error, THE Project_Editor SHALL display the returned error message within the same form section that triggered the action, position the message adjacent to the failing field or item identifier, and keep the message visible until the Admin modifies the related input or explicitly dismisses it.
2. IF a server action returns an error that cannot be attributed to a specific field, THEN THE Project_Editor SHALL display the error message as a section-level banner at the top of the surface that triggered the action, including the failure reason in plain text.
3. WHEN a per-file upload fails inside a multi-file selection, THE Media_Manager SHALL continue uploading the remaining queued files without interruption AND SHALL display a per-file error indicator next to the failed file showing the file name, the failure reason in plain text, and a "Retry" control.
4. WHEN the Admin invokes "Retry" on a failed queued file, THE Media_Manager SHALL request a new presigned URL and re-attempt the upload starting from byte 0, allowing up to 3 retry attempts per file before marking it as permanently failed.
5. IF a queued file reaches 3 failed retry attempts, THEN THE Media_Manager SHALL mark the file as permanently failed, remove the "Retry" control, retain the error indicator with the final failure reason, and SHALL NOT create a Media_Item for that file.
6. WHEN the Admin invokes "Cancel" on an in-flight queued upload, THE Media_Manager SHALL abort the underlying XHR within 1 second, remove the file from the upload queue, and SHALL NOT create a Media_Item for that file.
7. WHILE any file in the upload queue is in `uploading` status, THE Media_Manager SHALL render its current progress as an integer percentage from 0 to 100, updating the displayed value at least once every 500 milliseconds while bytes are being transferred.

### Requirement 14: Cache revalidation

**User Story:** As an Admin, I want my changes to appear on the public site as soon as I save, so that I do not have to wait for a stale page to expire before previewing my work.

#### Acceptance Criteria

1. WHEN a Project create, update, or delete operation succeeds, THE Project_Editor SHALL revalidate the path `/admin/projects`.
2. WHEN a Project create, update, or delete operation succeeds, THE Project_Editor SHALL revalidate the path `/gallery`.
3. WHEN a Project create, update, or delete operation succeeds for a Project with a non-empty `slug`, THE Project_Editor SHALL revalidate the path `/projects/{slug}`.
4. WHEN a Project's `slug` is updated from a non-empty old value to a different non-empty new value, THE Project_Editor SHALL revalidate both `/projects/{old_slug}` and `/projects/{new_slug}`.
5. IF revalidation of any path fails after a successful Project mutation, THEN THE Project_Editor SHALL preserve the persisted mutation and display a warning to the Admin indicating which paths failed to revalidate.

### Requirement 15: Migration from the existing editor

**User Story:** As the site owner, I want existing projects and media to keep working after this feature ships, so that no published case study breaks during the upgrade.

#### Acceptance Criteria

1. WHEN this feature is deployed, THE database migration SHALL preserve every existing `projects` row, `media_items` row, and `project_tags` row without data loss.
2. WHEN this feature is deployed, THE database migration SHALL backfill `Project.publishedAt` for every Project whose pre-deployment `status = published` and whose `publishedAt` is null, using `updatedAt` as the fallback timestamp.
3. WHEN this feature is deployed, THE database migration SHALL set `Project.scheduledAt` to null for every existing Project.
4. WHEN this feature is deployed, THE database migration SHALL extend the Allowed_Model_Mime allowlist to include `model/vnd.usdz+zip` without rejecting existing `model/gltf+json` or `model/gltf-binary` rows.
5. WHEN the Admin first opens the editor for a pre-existing Project after deployment, THE Project_Editor SHALL render the legacy `description` value as a seed `text` Section_Block per Requirement 1.13 without persisting it as a Section_Block until the Admin explicitly saves the Section_Editor.
6. WHEN the Admin saves the Section_Editor for the first time on a Project that has a non-empty `description`, THE Project_Editor SHALL retain the `description` column value unchanged so existing integrations and exports continue to read it.

### Requirement 16: Public rendering of Section_Blocks and 3D models

**User Story:** As a visitor reading a project page, I want section blocks to render in the order the artist authored them with the correct viewer per kind, so that I see the case study laid out as intended including interactive 3D models.

#### Acceptance Criteria

1. WHEN the Public_Renderer renders a Project that has one or more Section_Blocks, THE Public_Renderer SHALL render the Section_Blocks in ascending `ordering` order (lowest integer first) as the primary body content of the project detail page, and SHALL break ties by ascending Section_Block creation timestamp.
2. WHERE a Project has zero Section_Blocks but a non-empty `description` (length between 1 and 50000 characters after trimming), THE Public_Renderer SHALL render the legacy `description` as the primary body content of the project detail page.
3. WHEN the Public_Renderer encounters a `text` Section_Block, THE Public_Renderer SHALL render the `body` field as prose, preserving paragraph breaks, with a maximum length of 20000 characters per block.
4. IF a `text` Section_Block has an empty or whitespace-only `body`, THEN THE Public_Renderer SHALL skip that Section_Block from the rendered output without raising an error to the visitor.
5. WHEN the Public_Renderer encounters an `image` Section_Block, THE Public_Renderer SHALL render the referenced image Media_Item via `ResponsiveImage` so the Variant_Set is consumed per Requirement 6.5.
6. WHEN the Public_Renderer encounters an `image_pair` Section_Block, THE Public_Renderer SHALL render the two referenced image Media_Items as a two-column responsive layout at viewport widths of 768 pixels and above, and as a single-column stacked layout below 768 pixels.
7. IF an `image_pair` Section_Block has only one of its two referenced Media_Items available at render time, THEN THE Public_Renderer SHALL render the available Media_Item as a single-column image and SHALL omit the missing slot without raising an error to the visitor.
8. WHEN the Public_Renderer encounters a `video` Section_Block, THE Public_Renderer SHALL render the referenced video Media_Item using the same HTML5 `<video>` or iframe rule as Requirement 9.4.
9. WHEN the Public_Renderer encounters a `model3d` Section_Block whose Media_Item file extension (case-insensitive) is `glb` or `gltf`, THE Public_Renderer SHALL render an interactive `<model-viewer>` element pointing at the Media_Item `storageKey`.
10. WHEN the Public_Renderer encounters a `model3d` Section_Block whose Media_Item file extension (case-insensitive) is `usdz`, THE Public_Renderer SHALL render an Apple AR Quick Look anchor (`<a rel="ar" href="...">`) referencing the Media_Item `storageKey` so iOS Safari triggers AR mode.
11. IF a `model3d` Section_Block's referenced Media_Item has a file extension other than `glb`, `gltf`, or `usdz` (case-insensitive), THEN THE Public_Renderer SHALL skip that Section_Block from the rendered output without raising an error to the visitor.
12. IF a Section_Block's referenced Media_Item is missing, unresolved, or has no `storageKey` at render time, THEN THE Public_Renderer SHALL skip that Section_Block from the rendered output and SHALL continue rendering the remaining Section_Blocks without raising an error to the visitor.
