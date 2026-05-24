import { describe, expect, it } from "vitest";
import { selectLandingFeatured } from "@/lib/landing/featured";
import type {
  CategoryId,
  IsoDate,
  IsoTimestamp,
  Project,
  ProjectId,
  ProjectStatus,
  Slug,
} from "@/lib/types/domain";

/**
 * Unit tests for `selectLandingFeatured`.
 *
 * Spec references: Requirements 1.3, 1.6, 1.7, 1.8 and the design's
 * "Property 2: Landing featured selection".
 *
 * The companion property-based test is Task 3.4 (optional / orchestrator
 * does not auto-run it).
 */

interface FixtureSpec {
  id: string;
  status?: ProjectStatus;
  publishedAt?: string | null;
  featuredOrder?: number | null;
}

function makeProject(spec: FixtureSpec): Project {
  const status = spec.status ?? "published";
  return {
    id: spec.id as ProjectId,
    slug: `slug-${spec.id}` as Slug,
    title: `Project ${spec.id}`,
    description: "",
    categoryId: "renders" as CategoryId,
    tagIds: [],
    coverMediaId: null,
    mediaItems: [],
    softwareUsed: [],
    creationDate: "2024-01-01" as IsoDate,
    publishedAt:
      spec.publishedAt === undefined
        ? ("2024-01-01T00:00:00.000Z" as IsoTimestamp)
        : spec.publishedAt === null
          ? null
          : (spec.publishedAt as IsoTimestamp),
    scheduledAt: null,
    status,
    featuredOrder: spec.featuredOrder ?? null,
    createdAt: "2024-01-01T00:00:00.000Z" as IsoTimestamp,
    updatedAt: "2024-01-01T00:00:00.000Z" as IsoTimestamp,
  };
}

function ids(items: ReadonlyArray<Project>): string[] {
  return items.map((p) => p.id as string);
}

describe("selectLandingFeatured — admin-curated featured set", () => {
  it("returns the configured projects in the supplied order when 3..8 are configured (Req 1.3)", () => {
    const a = makeProject({ id: "a" });
    const b = makeProject({ id: "b" });
    const c = makeProject({ id: "c" });
    const d = makeProject({ id: "d" });

    const result = selectLandingFeatured({
      configured: [b, c, a],
      published: [a, b, c, d],
    });

    expect(result.usedFallback).toBe("none");
    expect(ids(result.items)).toEqual(["b", "c", "a"]);
  });

  it("accepts the boundary case of exactly 8 configured projects (Req 1.3)", () => {
    const configured = Array.from({ length: 8 }, (_unused, i) =>
      makeProject({ id: `p${i}` }),
    );

    const result = selectLandingFeatured({
      configured,
      published: configured,
    });

    expect(result.items).toHaveLength(8);
    expect(ids(result.items)).toEqual(ids(configured));
    expect(result.usedFallback).toBe("none");
  });

  it("accepts the boundary case of exactly 3 configured projects (Req 1.3)", () => {
    const configured = [
      makeProject({ id: "x" }),
      makeProject({ id: "y" }),
      makeProject({ id: "z" }),
    ];

    const result = selectLandingFeatured({
      configured,
      published: configured,
    });

    expect(ids(result.items)).toEqual(["x", "y", "z"]);
    expect(result.usedFallback).toBe("none");
  });
});

describe("selectLandingFeatured — fallback to most recent (Reqs 1.6, 1.7)", () => {
  it("falls back to the 6 most recent published when no featured are configured (Req 1.6)", () => {
    const published = [
      makeProject({ id: "1", publishedAt: "2024-01-01T00:00:00.000Z" }),
      makeProject({ id: "2", publishedAt: "2024-02-01T00:00:00.000Z" }),
      makeProject({ id: "3", publishedAt: "2024-03-01T00:00:00.000Z" }),
      makeProject({ id: "4", publishedAt: "2024-04-01T00:00:00.000Z" }),
      makeProject({ id: "5", publishedAt: "2024-05-01T00:00:00.000Z" }),
      makeProject({ id: "6", publishedAt: "2024-06-01T00:00:00.000Z" }),
      makeProject({ id: "7", publishedAt: "2024-07-01T00:00:00.000Z" }),
    ];

    const result = selectLandingFeatured({ configured: [], published });

    expect(ids(result.items)).toEqual(["7", "6", "5", "4", "3", "2"]);
    expect(result.usedFallback).toBe("recent");
  });

  it("falls back when fewer than 3 projects are configured (treated as no valid configuration, Req 1.3)", () => {
    const published = [
      makeProject({ id: "a", publishedAt: "2024-06-01T00:00:00.000Z" }),
      makeProject({ id: "b", publishedAt: "2024-05-01T00:00:00.000Z" }),
      makeProject({ id: "c", publishedAt: "2024-04-01T00:00:00.000Z" }),
      makeProject({ id: "d", publishedAt: "2024-03-01T00:00:00.000Z" }),
      makeProject({ id: "e", publishedAt: "2024-02-01T00:00:00.000Z" }),
      makeProject({ id: "f", publishedAt: "2024-01-01T00:00:00.000Z" }),
    ];

    const result = selectLandingFeatured({
      configured: [published[0]!, published[1]!],
      published,
    });

    expect(result.items).toHaveLength(6);
    expect(ids(result.items)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(result.usedFallback).toBe("recent");
  });

  it("falls back when more than 8 projects are configured (treated as no valid configuration)", () => {
    const published = Array.from({ length: 9 }, (_unused, i) =>
      makeProject({
        id: `p${i}`,
        publishedAt: `2024-0${i + 1}-01T00:00:00.000Z`,
      }),
    );

    const result = selectLandingFeatured({
      configured: published,
      published,
    });

    expect(result.items).toHaveLength(6);
    expect(ids(result.items)).toEqual(["p8", "p7", "p6", "p5", "p4", "p3"]);
    expect(result.usedFallback).toBe("recent");
  });

  it("returns all 1..5 published projects in publishedAt desc order when fewer than 6 exist (Req 1.7)", () => {
    const published = [
      makeProject({ id: "a", publishedAt: "2024-01-01T00:00:00.000Z" }),
      makeProject({ id: "b", publishedAt: "2024-02-01T00:00:00.000Z" }),
      makeProject({ id: "c", publishedAt: "2024-03-01T00:00:00.000Z" }),
    ];

    const result = selectLandingFeatured({ configured: [], published });

    expect(ids(result.items)).toEqual(["c", "b", "a"]);
    expect(result.usedFallback).toBe("recent");
  });

  it("breaks ties by id ascending when two recents share publishedAt", () => {
    const published = [
      makeProject({ id: "z", publishedAt: "2024-05-01T00:00:00.000Z" }),
      makeProject({ id: "a", publishedAt: "2024-05-01T00:00:00.000Z" }),
      makeProject({ id: "m", publishedAt: "2024-04-01T00:00:00.000Z" }),
    ];

    const result = selectLandingFeatured({ configured: [], published });

    expect(ids(result.items)).toEqual(["a", "z", "m"]);
    expect(result.usedFallback).toBe("recent");
  });
});

describe("selectLandingFeatured — empty branch (Req 1.8)", () => {
  it("returns an empty list with usedFallback=\"empty\" when no published projects exist", () => {
    const result = selectLandingFeatured({ configured: [], published: [] });

    expect(result.items).toEqual([]);
    expect(result.usedFallback).toBe("empty");
  });

  it("returns the empty result even when a stale configured set is passed but no published exist", () => {
    // Defensive: caller is expected to filter `configured` to published, but
    // the function still falls through to the empty branch when `published`
    // is empty and the configured size is outside the 3..8 band.
    const result = selectLandingFeatured({
      configured: [makeProject({ id: "stale" })],
      published: [],
    });

    expect(result.items).toEqual([]);
    expect(result.usedFallback).toBe("empty");
  });
});

describe("selectLandingFeatured — purity", () => {
  it("does not mutate either input array", () => {
    const a = makeProject({ id: "a", publishedAt: "2024-03-01T00:00:00.000Z" });
    const b = makeProject({ id: "b", publishedAt: "2024-02-01T00:00:00.000Z" });
    const c = makeProject({ id: "c", publishedAt: "2024-01-01T00:00:00.000Z" });
    const configured = [a, b, c];
    const published = [c, b, a];
    const originalConfigured = ids(configured);
    const originalPublished = ids(published);

    selectLandingFeatured({ configured, published });

    expect(ids(configured)).toEqual(originalConfigured);
    expect(ids(published)).toEqual(originalPublished);
  });
});
