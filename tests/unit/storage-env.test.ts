import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStorageEnv } from "@/lib/config/env";

const STORAGE_VARS = [
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_KMS_KEY_ID",
  "CDN_BASE_URL",
] as const;

describe("getStorageEnv", () => {
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

  it("does not throw at import time when env vars are absent", async () => {
    // The module was already imported above without env vars set; the import
    // itself must succeed. This test re-imports to assert that explicitly.
    await expect(import("@/lib/config/env")).resolves.toBeTruthy();
  });

  it("throws on first call when S3_REGION is missing", () => {
    process.env.S3_BUCKET = "bucket";
    process.env.CDN_BASE_URL = "https://cdn.test";
    expect(() => getStorageEnv()).toThrow(/S3_REGION/);
  });

  it("throws on first call when S3_BUCKET is missing", () => {
    process.env.S3_REGION = "us-east-1";
    process.env.CDN_BASE_URL = "https://cdn.test";
    expect(() => getStorageEnv()).toThrow(/S3_BUCKET/);
  });

  it("throws on first call when CDN_BASE_URL is missing", () => {
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = "bucket";
    expect(() => getStorageEnv()).toThrow(/CDN_BASE_URL/);
  });

  it("throws when CDN_BASE_URL is not a valid absolute URL", () => {
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = "bucket";
    process.env.CDN_BASE_URL = "not a url";
    expect(() => getStorageEnv()).toThrow(/CDN_BASE_URL must be an absolute URL/);
  });

  it("returns nullable secrets and KMS key when unset", () => {
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = "bucket";
    process.env.CDN_BASE_URL = "https://cdn.test";

    const env = getStorageEnv();
    expect(env).toEqual({
      s3Region: "us-east-1",
      s3Bucket: "bucket",
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3KmsKeyId: null,
      cdnBaseUrl: "https://cdn.test",
    });
  });

  it("returns secrets and KMS key when set, trimming whitespace", () => {
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = "bucket";
    process.env.CDN_BASE_URL = "https://cdn.test";
    process.env.S3_ACCESS_KEY_ID = "  AKIA  ";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_KMS_KEY_ID = "alias/portfolio";

    const env = getStorageEnv();
    expect(env.s3AccessKeyId).toBe("AKIA");
    expect(env.s3SecretAccessKey).toBe("secret");
    expect(env.s3KmsKeyId).toBe("alias/portfolio");
  });

  it("treats an empty string the same as unset", () => {
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = "bucket";
    process.env.CDN_BASE_URL = "https://cdn.test";
    process.env.S3_KMS_KEY_ID = "";

    const env = getStorageEnv();
    expect(env.s3KmsKeyId).toBeNull();
  });
});
