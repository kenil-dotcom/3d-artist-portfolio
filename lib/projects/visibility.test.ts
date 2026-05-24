/**
 * Unit tests for the project visibility safety helpers.
 *
 * Spec references: Requirements 3.10, 8.7, 8.8 and design "Property 8: Project
 * visibility safety". Property-based coverage is added in task 3.10.
 */

import { describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import {
  assertVisibleOrNull,
  filterPublic,
  getProjectBySlug,
  isPubliclyVisible,
} from "./visibility";
import type {
  CategoryId,
  IsoDate,
  IsoTimestamp,
  Project,
  ProjectId,
  ProjectStatus,
  Slug,
} from "@/lib/types/domain";

const NOW = new Date("2025-06-01T12:00:00.000Z");

interface BuildProjectOverrides {
  id?: string;
  slug?: string;
  status?: ProjectStatus;
  publishedAt?: IsoTimestamp | null;
}

function buildProject(overrides: BuildProjectOverrides = {}): Project {
  const id = (overrides.id ?? "11111111-1111-4111-8111-111111111111") as ProjectId;
  const slug = (overrides.slug ?? "demo-project") as Slug;
  const status = overrides.status ?? "published";
  const publishedAt =
    overrides.publishedAt === undefined
      ? ("2025-05-01T00:00:00.000Z" as IsoTimestamp)
      : overrides.publishedAt;

  return {
    id,
    slug,
    title: "Demo project",
    description: "",
    categoryId: "renders" as CategoryId,
    tagIds: [],
    coverMediaId: null,
    mediaItems: [],
    softwareUsed: [],
    creationDate: "2025-05-01" as IsoDate,
    publishedAt,
    status,
    featuredOrder: null,
    createdAt: "2025-04-01T00:00:00.000Z" as IsoTimestamp,
    updatedAt: "2025-05-01T00:00:00.000Z" as IsoTimestamp,
  };
}

describe("isPubliclyVisible", () => {
  const clock = fixedClock(NOW);

  it("returns true for a published project whose publishedAt is in the past", () => {
    const project = buildProject({
      status: "published",
      publishedAt: "2025-05-01T00:00:00.000Z" as IsoTimestamp,
    });

    expect(isPubliclyVisible(project, clock)).toBe(true);
  });

  it("returns true when publishedAt equals the current instant", () => {
    const project = buildProject({
      status: "published",
      publishedAt: NOW.toISOString() as IsoTimestamp,
    });

    expect(isPubliclyVisible(project, clock)).toBe(true);
  });

  it("returns false for draft projects even when publishedAt is set", () => {
    const project = buildProject({
      status: "draft",
      publishedAt: "2025-05-01T00:00:00.000Z" as IsoTimestamp,
    });

    expect(isPubliclyVisible(project, clock)).toBe(false);
  });

  it("returns false when publishedAt is null", () => {
    const project = buildProject({ status: "published", publishedAt: null });

    expect(isPubliclyVisible(project, clock)).toBe(false);
  });

  it("returns false when publishedAt is in the future relative to the clock", () => {
    const project = buildProject({
      status: "published",
      publishedAt: "2030-01-01T00:00:00.000Z" as IsoTimestamp,
    });

    expect(isPubliclyVisible(project, clock)).toBe(false);
  });

  it("returns false for a malformed publishedAt rather than throwing", () => {
    const project = buildProject({
      status: "published",
      publishedAt: "not-a-date" as IsoTimestamp,
    });

    expect(isPubliclyVisible(project, clock)).toBe(false);
  });

  it("uses the system clock by default", () => {
    // publishedAt is far in the past so the system clock will accept it.
    const project = buildProject({
      status: "published",
      publishedAt: "2000-01-01T00:00:00.000Z" as IsoTimestamp,
    });

    expect(isPubliclyVisible(project)).toBe(true);
  });
});

describe("assertVisibleOrNull", () => {
  const clock = fixedClock(NOW);

  it("returns the project when it is publicly visible", () => {
    const project = buildProject();
    expect(assertVisibleOrNull(project, clock)).toBe(project);
  });

  it("returns null when given null", () => {
    expect(assertVisibleOrNull(null, clock)).toBeNull();
  });

  it("returns null for a draft project so callers cannot distinguish draft from missing", () => {
    const draft = buildProject({ status: "draft" });
    const missing = null;

    expect(assertVisibleOrNull(draft, clock)).toBeNull();
    expect(assertVisibleOrNull(missing, clock)).toBeNull();
  });
});

describe("filterPublic", () => {
  const clock = fixedClock(NOW);

  it("keeps only publicly visible projects and preserves their input order", () => {
    const a = buildProject({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slug: "a" });
    const b = buildProject({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      slug: "b",
      status: "draft",
    });
    const c = buildProject({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      slug: "c",
      publishedAt: "2030-01-01T00:00:00.000Z" as IsoTimestamp,
    });
    const d = buildProject({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", slug: "d" });

    expect(filterPublic([a, b, c, d], clock)).toEqual([a, d]);
  });

  it("returns an empty array when no projects are visible", () => {
    const drafts = [
      buildProject({ slug: "x", status: "draft" }),
      buildProject({ slug: "y", status: "draft" }),
    ];

    expect(filterPublic(drafts, clock)).toEqual([]);
  });
});

describe("getProjectBySlug", () => {
  const clock = fixedClock(NOW);

  it("returns the matching project when it is publicly visible", () => {
    const target = buildProject({ slug: "target" });
    const others = [buildProject({ slug: "other-1" }), buildProject({ slug: "other-2" })];

    expect(getProjectBySlug([...others, target], "target", clock)).toBe(target);
  });

  it("returns null for unknown slugs", () => {
    const projects = [buildProject({ slug: "known" })];

    expect(getProjectBySlug(projects, "missing", clock)).toBeNull();
  });

  it("returns null for a draft project so 404 is byte-identical to missing", () => {
    const draft = buildProject({ slug: "secret-draft", status: "draft" });

    expect(getProjectBySlug([draft], "secret-draft", clock)).toBeNull();
    expect(getProjectBySlug([draft], "no-such-slug", clock)).toBeNull();
  });

  it("returns null when publishedAt is in the future", () => {
    const scheduled = buildProject({
      slug: "scheduled",
      publishedAt: "2030-01-01T00:00:00.000Z" as IsoTimestamp,
    });

    expect(getProjectBySlug([scheduled], "scheduled", clock)).toBeNull();
  });
});
