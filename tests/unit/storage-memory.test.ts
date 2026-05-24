import { describe, expect, it } from "vitest";
import { inMemoryStorage } from "@/lib/storage/memory";

describe("inMemoryStorage", () => {
  it("stores bytes and metadata under the supplied key", async () => {
    const storage = inMemoryStorage();
    const body = Buffer.from("hello world", "utf-8");

    await storage.putObject("media/abc.jpg", body, {
      contentType: "image/jpeg",
      contentHash: "deadbeef",
      isPublic: false,
    });

    const stored = storage.peek("media/abc.jpg");
    expect(stored).toBeDefined();
    expect(stored?.body.equals(body)).toBe(true);
    expect(stored?.contentType).toBe("image/jpeg");
    expect(stored?.contentHash).toBe("deadbeef");
    expect(stored?.isPublic).toBe(false);
  });

  it("makes a defensive copy of the bytes", async () => {
    const storage = inMemoryStorage();
    const body = Buffer.from([1, 2, 3, 4]);

    await storage.putObject("k", body, {
      contentType: "application/octet-stream",
      contentHash: "h",
      isPublic: false,
    });

    body.fill(0);
    const stored = storage.peek("k");
    expect(stored?.body).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("overwrites existing values at the same key", async () => {
    const storage = inMemoryStorage();
    await storage.putObject("k", Buffer.from("v1"), {
      contentType: "text/plain",
      contentHash: "h1",
      isPublic: true,
    });
    await storage.putObject("k", Buffer.from("v2"), {
      contentType: "text/plain",
      contentHash: "h2",
      isPublic: false,
    });

    const stored = storage.peek("k");
    expect(stored?.body.toString()).toBe("v2");
    expect(stored?.contentHash).toBe("h2");
    expect(stored?.isPublic).toBe(false);
    expect(storage.size()).toBe(1);
  });

  it("builds a CDN URL of the form base/key?v=hash", () => {
    const storage = inMemoryStorage({ cdnBaseUrl: "https://cdn.example.com/assets/" });
    const url = storage.getObjectUrl("media/2024/abc.jpg", "sha256-abc");
    expect(url).toBe("https://cdn.example.com/assets/media/2024/abc.jpg?v=sha256-abc");
  });

  it("URL-encodes path segments while preserving slashes", () => {
    const storage = inMemoryStorage({ cdnBaseUrl: "https://cdn.test" });
    const url = storage.getObjectUrl("media/special chars/é.jpg", "h");
    expect(url).toBe("https://cdn.test/media/special%20chars/%C3%A9.jpg?v=h");
  });

  it("strips a trailing slash from cdnBaseUrl and a leading slash from key", () => {
    const storage = inMemoryStorage({ cdnBaseUrl: "https://cdn.test/" });
    const url = storage.getObjectUrl("/media/x.png", "h1");
    expect(url).toBe("https://cdn.test/media/x.png?v=h1");
  });

  it("deleteObject removes the entry and is idempotent", async () => {
    const storage = inMemoryStorage();
    await storage.putObject("k", Buffer.from("v"), {
      contentType: "text/plain",
      contentHash: "h",
      isPublic: false,
    });
    expect(storage.size()).toBe(1);

    await storage.deleteObject("k");
    expect(storage.size()).toBe(0);

    // Re-deleting a missing key must not throw.
    await expect(storage.deleteObject("k")).resolves.toBeUndefined();
    await expect(storage.deleteObject("never-existed")).resolves.toBeUndefined();
  });

  it("getSignedUrl returns a deterministic URL with the requested expiry", async () => {
    const storage = inMemoryStorage();
    const url = await storage.getSignedUrl("private/inquiry/1.jpg", 600);
    expect(url).toBe("memory://signed/private/inquiry/1.jpg?expires=600");
  });

  it("rejects empty keys", async () => {
    const storage = inMemoryStorage();
    await expect(
      storage.putObject("", Buffer.from("v"), {
        contentType: "text/plain",
        contentHash: "h",
        isPublic: false,
      }),
    ).rejects.toThrow(/non-empty/);
    expect(() => storage.getObjectUrl("", "h")).toThrow(/non-empty/);
  });

  it("rejects non-positive or non-integer expiries", async () => {
    const storage = inMemoryStorage();
    await expect(storage.getSignedUrl("k", 0)).rejects.toThrow(RangeError);
    await expect(storage.getSignedUrl("k", -1)).rejects.toThrow(RangeError);
    await expect(storage.getSignedUrl("k", 1.5)).rejects.toThrow(RangeError);
    await expect(storage.getSignedUrl("k", Number.NaN)).rejects.toThrow(RangeError);
  });

  it("rejects malformed put options", async () => {
    const storage = inMemoryStorage();
    await expect(
      storage.putObject("k", Buffer.from("v"), {
        contentType: "",
        contentHash: "h",
        isPublic: true,
      }),
    ).rejects.toThrow(/contentType/);
    await expect(
      storage.putObject("k", Buffer.from("v"), {
        contentType: "text/plain",
        contentHash: "",
        isPublic: true,
      }),
    ).rejects.toThrow(/contentHash/);
    await expect(
      storage.putObject("k", Buffer.from("v"), {
        contentType: "text/plain",
        contentHash: "h",
        // @ts-expect-error intentionally invalid for runtime check
        isPublic: "yes",
      }),
    ).rejects.toThrow(/isPublic/);
  });

  it("clear() empties the store", async () => {
    const storage = inMemoryStorage();
    await storage.putObject("a", Buffer.from("1"), {
      contentType: "text/plain",
      contentHash: "h",
      isPublic: true,
    });
    await storage.putObject("b", Buffer.from("2"), {
      contentType: "text/plain",
      contentHash: "h",
      isPublic: true,
    });
    expect(storage.size()).toBe(2);
    storage.clear();
    expect(storage.size()).toBe(0);
  });
});
