-- Migration: artstation_upload
--
-- Adds the schema layer required by the ArtStation-inspired project upload
-- feature (see .kiro/specs/artstation-inspired-project-upload/design.md):
--
--   * ProjectStatus gains the `scheduled` value (slotted before `published`).
--   * SectionBlockKind enum is created.
--   * projects gains the nullable `scheduledAt` column plus the
--     `(status, scheduledAt)` composite index.
--   * media_items gains the nullable lowercase `extension` column and the
--     non-null `variantSet` JSONB column (default `'{}'::jsonb`).
--   * Backfills: `extension` is derived from `mimeType` for every existing
--     row; `publishedAt` is filled from `COALESCE(updatedAt, createdAt)` for
--     legacy `published` rows whose `publishedAt` is null.
--   * The `section_blocks` table is created with its primary key, foreign
--     keys (project Cascade, media items SetNull), and the
--     `(projectId, ordering)` index.
--
-- Migration order matches design.md "Migration order":
--   0. ALTER TYPE ProjectStatus ADD VALUE 'scheduled' BEFORE 'published'
--      (must run outside the transaction; Postgres requires ALTER TYPE
--      ADD VALUE to commit before the value is usable).
--   1. CREATE TYPE SectionBlockKind.
--   2. Snapshot pre-migration row counts and id sets into temp tables.
--   3. ALTER TABLE projects ADD COLUMN scheduledAt.
--   4. ALTER TABLE media_items ADD COLUMN extension.
--   5. ALTER TABLE media_items ADD COLUMN variantSet.
--   6. Backfill media_items.extension from mimeType.
--   7. Backfill projects.publishedAt = COALESCE(updatedAt, createdAt).
--   8. CREATE TABLE section_blocks plus foreign keys.
--   9. CREATE INDEX section_blocks_projectId_ordering_idx.
--  10. CREATE INDEX projects_status_scheduledAt_idx.
--  11. Post-condition assertions: projects/media_items row counts and id
--      sets must be bit-for-bit equal pre- and post-migration. Any drift
--      raises and rolls back the transaction (Requirement 15.1).
--
-- Step 0 runs outside the BEGIN/COMMIT block; everything else (steps 1
-- through 11) lives inside a single BEGIN ... COMMIT so column adds,
-- backfills, table create, indexes, and assertions either all land or
-- none of them do (Requirement 15.1).

-- ---------------------------------------------------------------------------
-- Step 0: enum value addition for ProjectStatus. Postgres requires
-- `ALTER TYPE ... ADD VALUE` to run outside any active transaction, so it
-- sits ahead of the BEGIN below.
-- ---------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'scheduled' BEFORE 'published';

-- ---------------------------------------------------------------------------
-- Steps 1-11: transactional block. Either all changes land or none of them
-- do (Requirement 15.1).
-- ---------------------------------------------------------------------------

BEGIN;

-- Step 1: SectionBlockKind enum.
-- CreateEnum
CREATE TYPE "SectionBlockKind" AS ENUM ('text', 'image', 'image_pair', 'video', 'model3d');

-- Step 2: snapshot pre-migration row counts and id sets into temp tables.
-- ON COMMIT DROP guarantees the snapshots vanish when the migration
-- commits or rolls back. Captured here on the first transactional
-- statement so the post-conditions in step 11 (and the unit test in task
-- 1.6) can assert against them.
CREATE TEMP TABLE "_artstation_upload_projects_pre" ON COMMIT DROP AS
  SELECT "id" FROM "projects";

CREATE TEMP TABLE "_artstation_upload_media_items_pre" ON COMMIT DROP AS
  SELECT "id" FROM "media_items";

-- Step 3: projects.scheduledAt nullable column.
-- AlterTable
ALTER TABLE "projects" ADD COLUMN "scheduledAt" TIMESTAMP(3);

-- Step 4: media_items.extension nullable column.
-- AlterTable
ALTER TABLE "media_items" ADD COLUMN "extension" VARCHAR(16);

-- Step 5: media_items.variantSet non-null column with empty-object default.
-- AlterTable
ALTER TABLE "media_items" ADD COLUMN "variantSet" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Step 6: backfill media_items.extension from the validated MIME type.
-- The mapping mirrors `MIME_TO_EXT` in `lib/admin/uploads.ts`. Rows whose
-- mime is not on the allow-list keep `extension = NULL`; the application
-- layer will repopulate them on the next replace.
UPDATE "media_items" SET "extension" = CASE "mimeType"
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp'
    WHEN 'video/mp4' THEN 'mp4'
    WHEN 'video/webm' THEN 'webm'
    WHEN 'model/gltf+json' THEN 'gltf'
    WHEN 'model/gltf-binary' THEN 'glb'
    WHEN 'model/vnd.usdz+zip' THEN 'usdz'
    ELSE NULL
  END
WHERE "extension" IS NULL;

-- Step 7: backfill publishedAt for legacy published projects. updatedAt is
-- the primary fallback; createdAt covers legacy rows whose updatedAt is
-- null (Requirement 15.2).
UPDATE "projects"
   SET "publishedAt" = COALESCE("updatedAt", "createdAt")
 WHERE "status" = 'published' AND "publishedAt" IS NULL;

-- Step 8: section_blocks table plus foreign keys.
-- CreateTable
CREATE TABLE "section_blocks" (
    "id"           UUID               NOT NULL DEFAULT gen_random_uuid(),
    "projectId"    UUID               NOT NULL,
    "kind"         "SectionBlockKind" NOT NULL,
    "ordering"     INTEGER            NOT NULL,
    "body"         TEXT,
    "mediaItemId"  UUID,
    "mediaItemBId" UUID,
    "createdAt"    TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3)       NOT NULL,

    CONSTRAINT "section_blocks_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "section_blocks"
  ADD CONSTRAINT "section_blocks_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_blocks"
  ADD CONSTRAINT "section_blocks_mediaItemId_fkey"
  FOREIGN KEY ("mediaItemId") REFERENCES "media_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_blocks"
  ADD CONSTRAINT "section_blocks_mediaItemBId_fkey"
  FOREIGN KEY ("mediaItemBId") REFERENCES "media_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 9: section_blocks (projectId, ordering) index.
-- CreateIndex
CREATE INDEX "section_blocks_projectId_ordering_idx"
  ON "section_blocks"("projectId", "ordering");

-- Step 10: projects (status, scheduledAt) composite index used by the
-- Publish_Worker query.
-- CreateIndex
CREATE INDEX "projects_status_scheduledAt_idx"
  ON "projects"("status", "scheduledAt");

-- Step 11: post-condition assertions. Row counts and primary-key sets must
-- match the pre-migration snapshots exactly; otherwise we abort the whole
-- transaction (Requirement 15.1).
DO $$
DECLARE
  pre_count  BIGINT;
  post_count BIGINT;
  diff_count BIGINT;
BEGIN
  -- projects: row count equality.
  SELECT COUNT(*) INTO pre_count  FROM "_artstation_upload_projects_pre";
  SELECT COUNT(*) INTO post_count FROM "projects";
  IF pre_count <> post_count THEN
    RAISE EXCEPTION 'artstation_upload: projects row count drift (pre=%, post=%)', pre_count, post_count;
  END IF;

  -- projects: id set equality (pre minus post must be empty).
  SELECT COUNT(*) INTO diff_count FROM (
    SELECT "id" FROM "_artstation_upload_projects_pre"
    EXCEPT
    SELECT "id" FROM "projects"
  ) AS missing;
  IF diff_count <> 0 THEN
    RAISE EXCEPTION 'artstation_upload: % project id(s) present pre-migration are missing post-migration', diff_count;
  END IF;

  -- projects: id set equality (post minus pre must be empty).
  SELECT COUNT(*) INTO diff_count FROM (
    SELECT "id" FROM "projects"
    EXCEPT
    SELECT "id" FROM "_artstation_upload_projects_pre"
  ) AS added;
  IF diff_count <> 0 THEN
    RAISE EXCEPTION 'artstation_upload: % project id(s) appeared post-migration that were absent pre-migration', diff_count;
  END IF;

  -- media_items: row count equality.
  SELECT COUNT(*) INTO pre_count  FROM "_artstation_upload_media_items_pre";
  SELECT COUNT(*) INTO post_count FROM "media_items";
  IF pre_count <> post_count THEN
    RAISE EXCEPTION 'artstation_upload: media_items row count drift (pre=%, post=%)', pre_count, post_count;
  END IF;

  -- media_items: id set equality (pre minus post must be empty).
  SELECT COUNT(*) INTO diff_count FROM (
    SELECT "id" FROM "_artstation_upload_media_items_pre"
    EXCEPT
    SELECT "id" FROM "media_items"
  ) AS missing;
  IF diff_count <> 0 THEN
    RAISE EXCEPTION 'artstation_upload: % media_item id(s) present pre-migration are missing post-migration', diff_count;
  END IF;

  -- media_items: id set equality (post minus pre must be empty).
  SELECT COUNT(*) INTO diff_count FROM (
    SELECT "id" FROM "media_items"
    EXCEPT
    SELECT "id" FROM "_artstation_upload_media_items_pre"
  ) AS added;
  IF diff_count <> 0 THEN
    RAISE EXCEPTION 'artstation_upload: % media_item id(s) appeared post-migration that were absent pre-migration', diff_count;
  END IF;
END;
$$;

COMMIT;
