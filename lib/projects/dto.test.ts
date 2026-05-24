/**
 * Unit tests for `buildProjectTile` and `buildProjectDetail`.
 *
 * Spec references: Requirements 2.2, 2.7, 3.1, 3.2 and design "Property 4:
 * Project tile DTO completeness" / "Property 5: Project detail field
 * rendering completeness". The companion property-based test is Task 3.6
 * (optional / orchestrator does not auto-run it).
 */

import { describe, expect, it } from "vitest";
import {
  PROJECT_FIELD_PLACEHOLDER,
  PROJECT_NO_MEDIA_MESSAGE,
  PROJECT_TILE_COVER_PLACEHOLDER_LABEL,
  PROJECT_TILE_TITLE_MAX,
  buildProjectDetail,
  buildProjectTile,
} from "./dto";
import type {
  Category,
  CategoryId,
  ContentHash,
  IsoDate,
  IsoTimestamp,
  MediaItem,
  MediaItemId,
  MediaRef,
  Project,
  ProjectId,
  Slug,
  Tag,
  TagId,
} from "@/lib/types/domain";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SLUG = "demo-project" as Slug;
const CATEGORY_ID = "renders" as CategoryId;

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    slug: SLUG,
    title: "Demo project",
    description: "A demo description.",
    categoryId: CATEGORY_ID,
    tagIds: [],
    coverMediaId: null,
    mediaItems: [],
    softwareUsed: [],
    creationDate: "2024-05-12" as IsoDate,
    publishedAt: "2024-05-12T00:00:00.000Z" as IsoTimestamp,
    scheduledAt: null,
    status: "published",
    featuredOrder: null,
    createdAt: "2024-05-01T00:00:00.000Z" as IsoTimestamp,
    updatedAt: "2024-05-12T00:00:00.000Z" as IsoTimestamp,
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: CATEGORY_ID,
    name: "Renders",
    ordering: 0,
    ...overrides,
  };
}

function makeTag(id: string, label: string, ordering = 0): Tag {
  return {
    id: id as TagId,
    label,
    ordering,
  };
}

function makeMediaRef(): MediaRef {
  return {
    storageKey: "media/demo.jpg",
    contentHash: "abc123" as ContentHash,
    mimeType: "image/jpeg",
    width: 1024,
    height: 1024,
    durationSec: null,
    byteSize: 1024,
  };
}

function makeMediaItem(idSuffix: string, ordering: number): MediaItem {
  return {
    id: `media-${idSuffix}` as MediaItemId,
    projectId: PROJECT_ID,
    ref: makeMediaRef(),
    kind: "image",
    altText: `alt for ${idSuffix}`,
    caption: null,
    ordering,
    captionsRef: null,
    transcript: null,
    embedUrl: null,
    extension: "jpg",
    variantSet: { renditions: [], failures: [] },
  };
}

// ---------------------------------------------------------------------------
// buildProjectTile
// ---------------------------------------------------------------------------

describe("buildProjectTile", () => {
  it("includes slug, href, resolved category name, and the cover URL when supplied", () => {
    const project = makeProject({ title: "My Project" });
    const tile = buildProjectTile(project, makeCategory(), "https://cdn/cover.avif");

    expect(tile.slug).toBe("demo-project");
    expect(tile.href).toBe("/projects/demo-project");
    expect(tile.title).toBe("My Project");
    expect(tile.titleTruncated).toBe(false);
    expect(tile.categoryName).toBe("Renders");
    expect(tile.categoryNamePlaceholder).toBe(false);
    expect(tile.coverImage).toEqual({ kind: "cover", url: "https://cdn/cover.avif" });
  });

  it("truncates titles longer than 80 chars and flags the truncation (Requirement 2.2)", () => {
    const longTitle = "A".repeat(120);
    const project = makeProject({ title: longTitle });

    const tile = buildProjectTile(project, makeCategory(), "https://cdn/c.jpg");

    expect(tile.title).toHaveLength(PROJECT_TILE_TITLE_MAX);
    expect(tile.title).toBe("A".repeat(PROJECT_TILE_TITLE_MAX));
    expect(tile.titleTruncated).toBe(true);
  });

  it("preserves titles of exactly 80 chars without flagging truncation", () => {
    const exactTitle = "B".repeat(PROJECT_TILE_TITLE_MAX);
    const project = makeProject({ title: exactTitle });

    const tile = buildProjectTile(project, makeCategory(), null);

    expect(tile.title).toBe(exactTitle);
    expect(tile.titleTruncated).toBe(false);
  });

  it("substitutes the placeholder cover when coverMediaUrl is null (Requirement 2.2)", () => {
    const tile = buildProjectTile(makeProject(), makeCategory(), null);

    expect(tile.coverImage).toEqual({
      kind: "placeholder",
      label: PROJECT_TILE_COVER_PLACEHOLDER_LABEL,
    });
  });

  it("renders the placeholder category name when the category lookup misses", () => {
    const tile = buildProjectTile(makeProject(), null, "https://cdn/c.jpg");

    expect(tile.categoryName).toBe(PROJECT_FIELD_PLACEHOLDER);
    expect(tile.categoryNamePlaceholder).toBe(true);
  });

  it("builds an href that always points at /projects/{slug} (Requirement 2.7)", () => {
    const project = makeProject({ slug: "another-slug" as Slug });

    const tile = buildProjectTile(project, makeCategory(), null);

    expect(tile.href).toBe("/projects/another-slug");
  });
});

// ---------------------------------------------------------------------------
// buildProjectDetail
// ---------------------------------------------------------------------------

describe("buildProjectDetail", () => {
  it("populates every labelled field with real values when the project is fully populated (Requirement 3.1)", () => {
    const project = makeProject({
      title: "Hero Render",
      description: "Lighting study.",
      tagIds: ["t-character", "t-fantasy"] as unknown as ReadonlyArray<TagId>,
      softwareUsed: ["Blender", "Substance Painter"] as ReadonlyArray<string>,
      creationDate: "2024-05-12" as IsoDate,
    });
    const tags: ReadonlyArray<Tag> = [
      makeTag("t-character", "Character"),
      makeTag("t-fantasy", "Fantasy"),
      makeTag("t-unused", "Unused"),
    ];

    const detail = buildProjectDetail(project, makeCategory(), tags, []);

    expect(detail.title).toBe("Hero Render");
    expect(detail.description).toBe("Lighting study.");
    expect(detail.categoryName).toBe("Renders");
    expect(detail.tagLabels).toEqual(["Character", "Fantasy"]);
    expect(detail.creationDate).toBe("May 12, 2024");
    expect(detail.softwareUsed).toEqual(["Blender", "Substance Painter"]);

    expect(detail.placeholders).toEqual({
      title: false,
      description: false,
      categoryName: false,
      tagLabels: false,
      creationDate: false,
      softwareUsed: false,
    });
  });

  it("surfaces placeholders for empty fields rather than omitting labels (Requirement 3.1)", () => {
    const project = makeProject({
      title: "   ",
      description: "",
      tagIds: [] as ReadonlyArray<TagId>,
      softwareUsed: [] as ReadonlyArray<string>,
      creationDate: "" as IsoDate,
    });

    const detail = buildProjectDetail(project, null, [], []);

    expect(detail.title).toBe(PROJECT_FIELD_PLACEHOLDER);
    expect(detail.description).toBe(PROJECT_FIELD_PLACEHOLDER);
    expect(detail.categoryName).toBe(PROJECT_FIELD_PLACEHOLDER);
    expect(detail.tagLabels).toEqual([]);
    expect(detail.creationDate).toBe(PROJECT_FIELD_PLACEHOLDER);
    expect(detail.softwareUsed).toEqual([]);

    expect(detail.placeholders).toEqual({
      title: true,
      description: true,
      categoryName: true,
      tagLabels: true,
      creationDate: true,
      softwareUsed: true,
    });
  });

  it("preserves mediaItems order exactly and disables the no-media flag (Requirement 3.2)", () => {
    const items = [
      makeMediaItem("a", 0),
      makeMediaItem("b", 1),
      makeMediaItem("c", 2),
    ];

    const detail = buildProjectDetail(makeProject(), makeCategory(), [], items);

    expect(detail.mediaItems.map((m) => m.id)).toEqual([
      "media-a",
      "media-b",
      "media-c",
    ]);
    expect(detail.noMediaMessage).toBe(false);
  });

  it("sets noMediaMessage when mediaItems is empty (Requirement 3.2)", () => {
    const detail = buildProjectDetail(makeProject(), makeCategory(), [], []);

    expect(detail.mediaItems).toEqual([]);
    expect(detail.noMediaMessage).toBe(true);
    // Exposed constant is unused at runtime but documents the UI message.
    expect(PROJECT_NO_MEDIA_MESSAGE).toBe("No media available");
  });

  it("orders tagLabels by project.tagIds, not by the input tag pool", () => {
    const project = makeProject({
      tagIds: ["t-z", "t-a", "t-m"] as unknown as ReadonlyArray<TagId>,
    });
    const pool = [
      makeTag("t-a", "Alpha"),
      makeTag("t-m", "Mike"),
      makeTag("t-z", "Zulu"),
    ];

    const detail = buildProjectDetail(project, makeCategory(), pool, []);

    expect(detail.tagLabels).toEqual(["Zulu", "Alpha", "Mike"]);
  });

  it("skips tag ids that are missing from the supplied tag pool", () => {
    const project = makeProject({
      tagIds: ["t-known", "t-orphan"] as unknown as ReadonlyArray<TagId>,
    });
    const pool = [makeTag("t-known", "Known")];

    const detail = buildProjectDetail(project, makeCategory(), pool, []);

    expect(detail.tagLabels).toEqual(["Known"]);
    expect(detail.placeholders.tagLabels).toBe(false);
  });

  it("treats whitespace-only software entries as empty for the placeholder check", () => {
    const project = makeProject({
      softwareUsed: ["  ", "", "\t"] as ReadonlyArray<string>,
    });

    const detail = buildProjectDetail(project, makeCategory(), [], []);

    expect(detail.softwareUsed).toEqual([]);
    expect(detail.placeholders.softwareUsed).toBe(true);
  });

  it("renders the placeholder for malformed creation dates rather than throwing", () => {
    const project = makeProject({ creationDate: "not-a-date" as IsoDate });

    const detail = buildProjectDetail(project, makeCategory(), [], []);

    expect(detail.creationDate).toBe(PROJECT_FIELD_PLACEHOLDER);
    expect(detail.placeholders.creationDate).toBe(true);
  });

  it("does not mutate the input mediaItems array", () => {
    const items = [makeMediaItem("a", 0), makeMediaItem("b", 1)];
    const before = items.slice();

    buildProjectDetail(makeProject(), makeCategory(), [], items);

    expect(items).toEqual(before);
  });
});
