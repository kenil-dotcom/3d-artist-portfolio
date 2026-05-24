-- AlterTable
ALTER TABLE "admin_users" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "audit_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "consent_records" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "deletion_tasks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "inquiries" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "media_items" ADD COLUMN     "embedUrl" VARCHAR(2048),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notification_jobs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reference_images" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "social_links" ALTER COLUMN "id" DROP DEFAULT;
