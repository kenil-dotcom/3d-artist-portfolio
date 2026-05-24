/**
 * Prisma client singleton.
 *
 * Next.js dev mode hot-reloads modules on every change which, naively, would
 * spawn a new `PrismaClient` per reload and exhaust the database connection
 * pool. We therefore cache the instance on `globalThis` in non-production
 * environments, mirroring the pattern recommended in the Prisma docs.
 *
 * In production a single fresh client is created once per process.
 *
 * Usage:
 *   import { prisma } from "@/lib/db/prisma";
 *   const projects = await prisma.project.findMany();
 */

import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * Build the Prisma client with environment-appropriate logging. In
 * development we log warnings and errors so missing indexes or N+1 traps
 * surface early; production stays silent unless an error occurs.
 */
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

export type { PrismaClient } from "@prisma/client";
