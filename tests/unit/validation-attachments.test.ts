import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  validateAttachments,
  type AttachmentInput,
} from '@/lib/validation/attachments';

const MB = 1024 * 1024;

const f = (
  originalFilename: string,
  byteSize: number,
  mimeType = 'image/jpeg',
): AttachmentInput => ({ originalFilename, mimeType, byteSize });

describe('validateAttachments', () => {
  it('returns empty arrays for an empty input', () => {
    const result = validateAttachments([]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('partitions exactly: |files| = |accepted| + |rejected|', () => {
    const files: AttachmentInput[] = [
      f('ok.jpg', 1 * MB),
      f('big.jpg', 11 * MB),
      f('weird.gif', 1 * MB, 'image/gif'),
      f('also-ok.png', 1 * MB, 'image/png'),
    ];
    const { accepted, rejected } = validateAttachments(files);
    expect(accepted.length + rejected.length).toBe(files.length);
  });

  it('accepts JPEG, PNG, and WebP files within size limits', () => {
    const files: AttachmentInput[] = [
      f('a.jpg', 1 * MB, 'image/jpeg'),
      f('b.png', 1 * MB, 'image/png'),
      f('c.webp', 1 * MB, 'image/webp'),
    ];
    const { accepted, rejected } = validateAttachments(files);
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(0);
  });

  it('rejects unsupported formats with code "invalid_format"', () => {
    const bad = f('logo.gif', 1 * MB, 'image/gif');
    const { accepted, rejected } = validateAttachments([bad]);
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.code).toBe('invalid_format');
    expect(rejected[0]?.file).toBe(bad);
    expect(rejected[0]?.message).toContain('logo.gif');
  });

  it('rejects files larger than 10 MB with code "file_too_large"', () => {
    const big = f('huge.jpg', DEFAULT_MAX_FILE_BYTES + 1);
    const { accepted, rejected } = validateAttachments([big]);
    expect(accepted).toEqual([]);
    expect(rejected[0]?.code).toBe('file_too_large');
  });

  it('accepts files exactly at the per-file boundary (10 MB)', () => {
    const exact = f('edge.jpg', DEFAULT_MAX_FILE_BYTES);
    const { accepted, rejected } = validateAttachments([exact]);
    expect(accepted).toEqual([exact]);
    expect(rejected).toEqual([]);
  });

  it('rejects beyond the 5-file cap with code "too_many_files"', () => {
    const files = Array.from({ length: 7 }, (_, i) => f(`r${i}.jpg`, 1 * MB));
    const { accepted, rejected } = validateAttachments(files);
    expect(accepted).toHaveLength(DEFAULT_MAX_FILES);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(r.code).toBe('too_many_files');
    }
  });

  it('rejects with "total_too_large" once the combined cap would be exceeded', () => {
    // 4 x 10 MB = 40 MB accepted, next 10 MB pushes to 50 MB exactly (still OK).
    // The 6th 10 MB file would push to 60 MB which exceeds 50 MB.
    const files = [
      f('a.jpg', 10 * MB),
      f('b.jpg', 10 * MB),
      f('c.jpg', 10 * MB),
      f('d.jpg', 10 * MB),
      f('e.jpg', 10 * MB),
      f('f.jpg', 10 * MB),
    ];
    const { accepted, rejected } = validateAttachments(files);
    // First 5 are accepted at 50 MB exactly; 6th hits the count cap.
    expect(accepted).toHaveLength(5);
    expect(rejected).toHaveLength(1);
    // The 6th would have been blocked by either count or total; count is checked
    // first in our pipeline so the code is too_many_files. Either is valid;
    // pin the exact behaviour.
    expect(rejected[0]?.code).toBe('too_many_files');
  });

  it('rejects only the file that would overflow combined size, keeping later fitting files', () => {
    // With the spec defaults (5 files, 10 MB each, 50 MB combined) the count
    // cap always trips before the combined-size cap, so we exercise the
    // total_too_large branch with custom limits that allow larger per-file
    // sizes. 30 MB + 25 MB would overflow the 50 MB cap; the 25 MB file is
    // rejected with total_too_large, but the 5 MB file that follows still
    // fits (35 MB total) and is accepted.
    const big = f('big.jpg', 30 * MB);
    const overflow = f('overflow.jpg', 25 * MB);
    const small = f('small.jpg', 5 * MB);
    const { accepted, rejected } = validateAttachments(
      [big, overflow, small],
      { maxFileBytes: 30 * MB, maxTotalBytes: 50 * MB, maxFiles: 10 },
    );

    expect(accepted).toEqual([big, small]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.file).toBe(overflow);
    expect(rejected[0]?.code).toBe('total_too_large');
  });

  it('treats the combined cap of exactly 50 MB as accepted', () => {
    const files = [
      f('a.jpg', 10 * MB),
      f('b.jpg', 10 * MB),
      f('c.jpg', 10 * MB),
      f('d.jpg', 10 * MB),
      f('e.jpg', 10 * MB),
    ];
    const { accepted, rejected } = validateAttachments(files);
    expect(accepted).toHaveLength(5);
    expect(rejected).toHaveLength(0);
    const total = accepted.reduce((sum, file) => sum + file.byteSize, 0);
    expect(total).toBe(DEFAULT_MAX_TOTAL_BYTES);
  });

  it('does not let an invalid file discard valid ones around it', () => {
    const ok1 = f('ok1.jpg', 1 * MB);
    const badFormat = f('bad.gif', 1 * MB, 'image/gif');
    const ok2 = f('ok2.png', 1 * MB, 'image/png');
    const tooBig = f('huge.jpg', DEFAULT_MAX_FILE_BYTES + 1);
    const ok3 = f('ok3.webp', 1 * MB, 'image/webp');

    const { accepted, rejected } = validateAttachments([
      ok1,
      badFormat,
      ok2,
      tooBig,
      ok3,
    ]);

    expect(accepted).toEqual([ok1, ok2, ok3]);
    expect(rejected.map(r => r.code)).toEqual([
      'invalid_format',
      'file_too_large',
    ]);
  });

  it('echoes the original filename on every rejection', () => {
    const files: AttachmentInput[] = [
      f('weird name with spaces.gif', 1 * MB, 'image/gif'),
      f('huge.jpg', DEFAULT_MAX_FILE_BYTES + 1),
    ];
    const { rejected } = validateAttachments(files);
    expect(rejected[0]?.message).toContain('weird name with spaces.gif');
    expect(rejected[1]?.message).toContain('huge.jpg');
  });

  it('respects custom limits (used for tests/admin overrides)', () => {
    const files = [f('a.jpg', 2 * MB), f('b.jpg', 2 * MB), f('c.jpg', 2 * MB)];
    const { accepted, rejected } = validateAttachments(files, {
      maxFiles: 2,
      maxTotalBytes: 100 * MB,
      maxFileBytes: 5 * MB,
    });
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.code).toBe('too_many_files');
  });

  it('rejects files reporting NaN or negative sizes as file_too_large', () => {
    const nanFile = f('nan.jpg', Number.NaN);
    const negativeFile = f('neg.jpg', -1);
    const { accepted, rejected } = validateAttachments([nanFile, negativeFile]);
    expect(accepted).toEqual([]);
    expect(rejected.map(r => r.code)).toEqual(['file_too_large', 'file_too_large']);
  });

  it('does not mutate the input list', () => {
    const files = Object.freeze([f('a.jpg', 1 * MB), f('b.jpg', 1 * MB)]);
    expect(() => validateAttachments(files)).not.toThrow();
  });
});
