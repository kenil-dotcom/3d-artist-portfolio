-- Initial migration for the 3D Artist Portfolio schema.
-- Mirrors prisma/schema.prisma.
--
-- This file is intended for environments where `prisma migrate dev` cannot be
-- executed at scaffold time. To adopt it as the baseline migration after
-- provisioning Postgres run:
--   prisma migrate resolve --applied "0_init"
-- followed by `prisma generate`.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('image', 'video', 'model3d');

-- CreateEnum
CREATE TYPE "InquiryType" AS ENUM ('contact', 'commission');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('new', 'read', 'archived', 'pending_deletion');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('Character', 'Environment', 'ProductVisualization', 'Animation', 'Other');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "DeletionTaskState" AS ENUM ('pending', 'succeeded', 'failed_manual');

-- CreateEnum
CREATE TYPE "ConsentDecision" AS ENUM ('accepted', 'rejected');

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "ordering" INTEGER NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "ordering" INTEGER NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(80) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "coverMediaId" UUID,
    "softwareUsed" VARCHAR(60)[],
    "creationDate" DATE NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "status" "ProjectStatus" NOT NULL DEFAULT 'draft',
    "featuredOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tags" (
    "projectId" UUID NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "project_tags_pkey" PRIMARY KEY ("projectId","tagId")
);

-- CreateTable
CREATE TABLE "media_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "mimeType" VARCHAR(60) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "byteSize" INTEGER NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "altText" VARCHAR(500),
    "caption" VARCHAR(200),
    "ordering" INTEGER NOT NULL,
    "captionsStorageKey" VARCHAR(512),
    "captionsContentHash" VARCHAR(64),
    "captionsMimeType" VARCHAR(60),
    "captionsByteSize" INTEGER,
    "transcript" TEXT,

    CONSTRAINT "media_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bio" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "artistName" VARCHAR(100) NOT NULL,
    "tagline" VARCHAR(160) NOT NULL,
    "biography" TEXT NOT NULL,
    "profileImageStorageKey" VARCHAR(512),
    "profileImageContentHash" VARCHAR(64),
    "profileImageMimeType" VARCHAR(60),
    "profileImageWidth" INTEGER,
    "profileImageHeight" INTEGER,
    "profileImageByteSize" INTEGER,
    "resumeStorageKey" VARCHAR(512),
    "resumeContentHash" VARCHAR(64),
    "resumeMimeType" VARCHAR(60),
    "resumeByteSize" INTEGER,
    "skills" VARCHAR(60)[],
    "software" VARCHAR(60)[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bioId" TEXT NOT NULL,
    "platform" VARCHAR(40) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "ordering" INTEGER NOT NULL,

    CONSTRAINT "social_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_range_options" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "ordering" INTEGER NOT NULL,

    CONSTRAINT "budget_range_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "InquiryType" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(200),
    "message" TEXT NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'new',
    "projectType" "ProjectType",
    "budgetRangeId" TEXT,
    "targetDeadline" DATE,
    "clientIp" VARCHAR(64) NOT NULL,
    "userAgent" VARCHAR(500),
    "encryptedAtRest" BOOLEAN NOT NULL DEFAULT true,
    "notificationJobId" UUID,
    "deliveryFailed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inquiryId" UUID NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "mimeType" VARCHAR(60) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "originalFilename" VARCHAR(260) NOT NULL,

    CONSTRAINT "reference_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(60) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "adminId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inquiryId" UUID NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "state" "JobState" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inquiryId" UUID NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "state" "DeletionTaskState" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deletion_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorId" UUID NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetId" VARCHAR(120),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "decision" "ConsentDecision" NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "subjectHash" VARCHAR(128) NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_publishedAt_idx" ON "projects"("publishedAt" DESC);

-- CreateIndex
CREATE INDEX "project_tags_tagId_idx" ON "project_tags"("tagId");

-- CreateIndex
CREATE INDEX "media_items_projectId_ordering_idx" ON "media_items"("projectId", "ordering");

-- CreateIndex
CREATE INDEX "social_links_bioId_ordering_idx" ON "social_links"("bioId", "ordering");

-- CreateIndex
CREATE INDEX "inquiries_submittedAt_status_idx" ON "inquiries"("submittedAt" DESC, "status");

-- CreateIndex
CREATE INDEX "reference_images_inquiryId_idx" ON "reference_images"("inquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE INDEX "sessions_adminId_idx" ON "sessions"("adminId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "notification_jobs_state_nextRunAt_idx" ON "notification_jobs"("state", "nextRunAt");

-- CreateIndex
CREATE INDEX "deletion_tasks_state_nextRunAt_idx" ON "deletion_tasks"("state", "nextRunAt");

-- CreateIndex
CREATE INDEX "audit_events_occurredAt_idx" ON "audit_events"("occurredAt" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "consent_records_subjectHash_idx" ON "consent_records"("subjectHash");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "media_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_links" ADD CONSTRAINT "social_links_bioId_fkey" FOREIGN KEY ("bioId") REFERENCES "bio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_budgetRangeId_fkey" FOREIGN KEY ("budgetRangeId") REFERENCES "budget_range_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_tasks" ADD CONSTRAINT "deletion_tasks_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
