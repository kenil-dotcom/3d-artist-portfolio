import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

// Stub the presigner before importing the module under test so the SDK is
// never actually contacted. The mock returns a deterministic URL embedding
// the bucket, key, and expiry.
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_client: S3Client, command: { input: { Bucket: string; Key: string } }, opts: { expiresIn: number }) => {
    const { Bucket, Key } = command.input;
    return `https://signed.test/${Bucket}/${Key}?expires=${opts.expiresIn}`;
  }),
}));

import { s3Storage } from "@/lib/storage/s3";

interface CapturedCommand {
  ctor: string;
  input: Record<string, unknown>;
}

function makeFakeClient(): { client: S3Client; sent: CapturedCommand[] } {
  const sent: CapturedCommand[] = [];
  const client = {
    send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ ctor: command.constructor.name, input: command.input });
      return {};
    }),
    config: { region: () => "us-east-1" },
  } as unknown as S3Client;
  return { client, sent };
}

const STORAGE_VARS = [
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_KMS_KEY_ID",
  "CDN_BASE_URL",
] as const;

describe("s3Storage", () => {
  let original: Record<string, string | undefined> = {};

  beforeEach(() => {
    original = {};
    for (const k of STORAGE_VARS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of STORAGE_VARS) {
      const v = original[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("does not throw at construction when env vars are unset", () => {
    expect(() => s3Storage()).not.toThrow();
  });

  it("throws on first call when env vars are missing and no overrides given", async () => {
    const storage = s3Storage();
    await expect(
      storage.putObject("k", Buffer.from("v"), {
        contentType: "text/plain",
        contentHash: "h",
        isPublic: false,
      }),
    ).rejects.toThrow(/S3_REGION|required/);
  });

  it("uses SSE-S3 (AES256) when no KMS key is configured", async () => {
    const { client, sent } = makeFakeClient();
    const storage = s3Storage({
      bucket: "bucket",
      region: "us-east-1",
      cdnBaseUrl: "https://cdn.test",
      kmsKeyId: null,
      client,
    });

    await storage.putObject("media/a.jpg", Buffer.from("bytes"), {
      contentType: "image/jpeg",
      contentHash: "abc123",
      isPublic: false,
    });

    expect(sent).toHaveLength(1);
    const put = sent[0]!;
    expect(put.ctor).toBe(PutObjectCommand.name);
    expect(put.input.Bucket).toBe("bucket");
    expect(put.input.Key).toBe("media/a.jpg");
    expect(put.input.ContentType).toBe("image/jpeg");
    expect(put.input.ServerSideEncryption).toBe("AES256");
    expect(put.input.SSEKMSKeyId).toBeUndefined();
    expect(put.input.Metadata).toEqual({ "content-hash": "abc123" });
  });

  it("uses SSE-KMS with the supplied key when configured", async () => {
    const { client, sent } = makeFakeClient();
    const storage = s3Storage({
      bucket: "bucket",
      region: "us-east-1",
      cdnBaseUrl: "https://cdn.test",
      kmsKeyId: "alias/portfolio",
      client,
    });

    await storage.putObject("media/a.jpg", Buffer.from("bytes"), {
      contentType: "image/jpeg",
      contentHash: "abc123",
      isPublic: false,
    });

    const put = sent[0]!;
    expect(put.input.ServerSideEncryption).toBe("aws:kms");
    expect(put.input.SSEKMSKeyId).toBe("alias/portfolio");
  });

  it("reads SSE-KMS configuration from the environment when not overridden", async () => {
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = "bucket";
    process.env.CDN_BASE_URL = "https://cdn.test";
    process.env.S3_KMS_KEY_ID = "alias/from-env";

    const { client, sent } = makeFakeClient();
    const storage = s3Storage({ client });
    await storage.putObject("k", Buffer.from("v"), {
      contentType: "text/plain",
      contentHash: "h",
      isPublic: false,
    });

    const put = sent[0]!;
    expect(put.input.ServerSideEncryption).toBe("aws:kms");
    expect(put.input.SSEKMSKeyId).toBe("alias/from-env");
  });

  it("getObjectUrl embeds the cdnBaseUrl, key, and content hash", () => {
    const { client } = makeFakeClient();
    const storage = s3Storage({
      bucket: "bucket",
      region: "us-east-1",
      cdnBaseUrl: "https://cdn.example.com",
      client,
    });

    expect(storage.getObjectUrl("media/2024/abc.jpg", "sha256-abc")).toBe(
      "https://cdn.example.com/media/2024/abc.jpg?v=sha256-abc",
    );
  });

  it("deleteObject sends a DeleteObjectCommand for the right key", async () => {
    const { client, sent } = makeFakeClient();
    const storage = s3Storage({
      bucket: "bucket",
      region: "us-east-1",
      cdnBaseUrl: "https://cdn.test",
      client,
    });

    await storage.deleteObject("media/a.jpg");

    expect(sent).toHaveLength(1);
    expect(sent[0]!.ctor).toBe(DeleteObjectCommand.name);
    expect(sent[0]!.input.Bucket).toBe("bucket");
    expect(sent[0]!.input.Key).toBe("media/a.jpg");
  });

  it("getSignedUrl delegates to the presigner with the supplied expiry", async () => {
    const { client } = makeFakeClient();
    const storage = s3Storage({
      bucket: "bucket",
      region: "us-east-1",
      cdnBaseUrl: "https://cdn.test",
      client,
    });

    const url = await storage.getSignedUrl("private/x.jpg", 900);
    expect(url).toBe("https://signed.test/bucket/private/x.jpg?expires=900");
  });

  it("rejects empty keys and invalid expiries", async () => {
    const { client } = makeFakeClient();
    const storage = s3Storage({
      bucket: "bucket",
      region: "us-east-1",
      cdnBaseUrl: "https://cdn.test",
      client,
    });

    await expect(
      storage.putObject("", Buffer.from("v"), {
        contentType: "text/plain",
        contentHash: "h",
        isPublic: false,
      }),
    ).rejects.toThrow(/non-empty/);
    await expect(storage.deleteObject("")).rejects.toThrow(/non-empty/);
    await expect(storage.getSignedUrl("k", 0)).rejects.toThrow(RangeError);
    await expect(storage.getSignedUrl("k", -5)).rejects.toThrow(RangeError);
  });
});
