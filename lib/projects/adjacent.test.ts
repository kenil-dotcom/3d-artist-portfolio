/**
 * Unit tests for the canonical adjacent project navigation helper.
 *
 * Spec references:
 *  - Requirement 3.9 — visible prev/next controls disabled at the endpoints
 *    of the publication-date-descending list.
 *  - Design "Property 7: Adjacent project navigation" — for the published
 *    list ordered by `publishedAt` desc, `prev = projects[i - 1]` (else
 *    NULL) and `next = projects[i + 1]` (else NULL). Property-based
 *    coverage is added in task 3.8.
 */

import { describe, expect, it } from "vitest";
import { getAdjacentProjects } from "./adjacent";
import type {
  CategoryId,
  IsoDate,
  IsoTimestamp,
  Project,
  ProjectId,
  Slug,
} from "@/lib/types/domain";

/**
 * Build a minimal published `Project` fixture so each test only has to
 * override the fields that matter (slug, publishedAt). `getAdjacentProjects`
 * expects callers to have already filtered to publicly visible projects, so
 * the default fixture is `status: "published"` with a real `publishedAt`.
 */
function makeProject(overrides: {
  slug: string;
  publishedAt: string;
}): Project {
  return {
    id: `id-${overrides.slug}` as ProjectId,
    slug: overrides.slug as Slug,
    title: `Title ${overrides.slug}`,
    description: "",
    categoryId: "cat-1" as CategoryId,
    tagIds: [],
    coverMediaId: null,
    mediaItems: [],
    softwareUsed: [],
    creationDate: "2024-01-01" as IsoDate,
    publishedAt: overrides.publishedAt as IsoTimestamp,
    scheduledAt: null,
    status: "published",
    featuredOrder: null,
    createdAt: "2024-01-01T00:00:00.000Z" as IsoTimestamp,
    updatedAt: "2024-01-01T00:00:00.000Z" as IsoTimestamp,
  };
}

describe("getAdjacentProjects", () => {
  it("returns the prev (more recent) and next (older) projects in the middle of the list", () => {
    // publishedAt desc order: newest -> middle -> oldest
    const newest = makeProject({ slug: "a", publishedAt: "2024-03-01T00:00:00.000Z" });
    const middle = makeProject({ slug: "b", publishedAt: "2024-02-01T00:00:00.000Z" });
    const oldest = makeProject({ slug: "c", publishedAt: "2024-01-01T00:00:00.000Z" });

    // Pass them in shuffled order to verify the function does the sort.
    const result = getAdjacentProjects([oldest, newest, middle], "b");

    expect(result.prev?.slug).toBe("a");
    expect(result.next?.slug).toBe("c");
  });

  it("returns prev=null for the most-recently-published project (top endpoint)", () => {
    const newest = makeProject({ slug: "a", publishedAt: "2024-03-01T00:00:00.000Z" });
    const older = makeProject({ slug: "b", publishedAt: "2024-02-01T00:00:00.000Z" });

    const result = getAdjacentProjects([newest, older], "a");

    expect(result.prev).toBeNull();
    expect(result.next?.slug).toBe("b");
  });

  it("returns next=null for the oldest published project (bottom endpoint)", () => {
    const newest = makeProject({ slug: "a", publishedAt: "2024-03-01T00:00:00.000Z" });
    const oldest = makeProject({ slug: "b", publishedAt: "2024-01-01T00:00:00.000Z" });

    const result = getAdjacentProjects([newest, oldest], "b");

    expect(result.prev?.slug).toBe("a");
    expect(result.next).toBeNull();
  });

  it("returns both null for a single published project", () => {
    const only = makeProject({ slug: "solo", publishedAt: "2024-03-01T00:00:00.000Z" });

    const result = getAdjacentProjects([only], "solo");

    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
  });

  it("returns both null when slug is unknown", () => {
    const a = makeProject({ slug: "a", publishedAt: "2024-03-01T00:00:00.000Z" });
    const b = makeProject({ slug: "b", publishedAt: "2024-02-01T00:00:00.000Z" });

    const result = getAdjacentProjects([a, b], "missing");

    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
  });

  it("returns both null when the catalogue is empty", () => {
    const result = getAdjacentProjects([], "anything");

    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
  });

  it("breaks publishedAt ties deterministically by slug ascending", () => {
    // Three projects share the same publishedAt; slug ascending is
    // c < d < e, so prev/next of "d" must be "c" and "e" respectively.
    const sameTime = "2024-02-01T00:00:00.000Z";
    const c = makeProject({ slug: "c", publishedAt: sameTime });
    const d = makeProject({ slug: "d", publishedAt: sameTime });
    const e = makeProject({ slug: "e", publishedAt: sameTime });

    // Pass them in shuffled order to verify the function does the sort.
    const result = getAdjacentProjects([e, c, d], "d");

    expect(result.prev?.slug).toBe("c");
    expect(result.next?.slug).toBe("e");
  });

  it("walks a five-project catalogue end to end", () => {
    const list = [
      makeProject({ slug: "a", publishedAt: "2024-01-01T00:00:00.000Z" }),
      makeProject({ slug: "b", publishedAt: "2024-02-01T00:00:00.000Z" }),
      makeProject({ slug: "c", publishedAt: "2024-03-01T00:00:00.000Z" }),
      makeProject({ slug: "d", publishedAt: "2024-04-01T00:00:00.000Z" }),
      makeProject({ slug: "e", publishedAt: "2024-05-01T00:00:00.000Z" }),
    ];

    // Newest endpoint: no prev, next is one step older.
    const top = getAdjacentProjects(list, "e");
    expect(top.prev).toBeNull();
    expect(top.next?.slug).toBe("d");

    // Middle: prev is newer, next is older.
    const mid = getAdjacentProjects(list, "c");
    expect(mid.prev?.slug).toBe("d");
    expect(mid.next?.slug).toBe("b");

    // Oldest endpoint: prev is one step newer, no next.
    const bottom = getAdjacentProjects(list, "a");
    expect(bottom.prev?.slug).toBe("b");
    expect(bottom.next).toBeNull();
  });

  it("does not mutate the input array", () => {
    const a = makeProject({ slug: "a", publishedAt: "2024-03-01T00:00:00.000Z" });
    const b = makeProject({ slug: "b", publishedAt: "2024-02-01T00:00:00.000Z" });
    const input = [b, a];
    const snapshot = [...input];

    getAdjacentProjects(input, "a");

    expect(input).toEqual(snapshot);
  });
});
