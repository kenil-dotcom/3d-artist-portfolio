import { describe, expect, it } from 'vitest';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_MODEL_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_MEDIA_BYTES,
  validateMediaUpload,
  type MediaUploadInput,
} from '@/lib/validation/media';
import type { MediaKind } from '@/lib/types/domain';

const ONE_MB = 1024 * 1024;

function makeInput(overrides: Partial<MediaUploadInput> = {}): MediaUploadInput {
  return {
    kind: 'image',
    mimeType: 'image/jpeg',
    byteSize: 1024,
    filename: 'asset.bin',
    ...overrides,
  };
}

describe('validateMediaUpload — happy path', () => {
  it.each(ALLOWED_IMAGE_MIME_TYPES)(
    'accepts image %s under 100 MB',
    (mimeType) => {
      const result = validateMediaUpload(
        makeInput({ kind: 'image', mimeType, byteSize: 5 * ONE_MB }),
      );
      expect(result).toEqual({ ok: true });
    },
  );

  it.each(ALLOWED_VIDEO_MIME_TYPES)(
    'accepts video %s under 100 MB',
    (mimeType) => {
      const result = validateMediaUpload(
        makeInput({ kind: 'video', mimeType, byteSize: 90 * ONE_MB }),
      );
      expect(result).toEqual({ ok: true });
    },
  );

  it.each(ALLOWED_MODEL_MIME_TYPES)(
    'accepts model3d %s under 100 MB',
    (mimeType) => {
      const result = validateMediaUpload(
        makeInput({ kind: 'model3d', mimeType, byteSize: 50 * ONE_MB }),
      );
      expect(result).toEqual({ ok: true });
    },
  );

  it('accepts a file at exactly the 100 MB ceiling', () => {
    const result = validateMediaUpload(
      makeInput({ kind: 'image', mimeType: 'image/png', byteSize: MAX_MEDIA_BYTES }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('accepts a 0-byte file with an allowed mime type', () => {
    const result = validateMediaUpload(
      makeInput({ kind: 'video', mimeType: 'video/webm', byteSize: 0 }),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('validateMediaUpload — invalid_format rejection', () => {
  it('rejects unrecognised mime types', () => {
    const result = validateMediaUpload(
      makeInput({
        kind: 'image',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        byteSize: 1024,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('invalid_format');
      expect(result.message).toContain('doc.pdf');
      expect(result.message).toContain('application/pdf');
    }
  });

  it('rejects image/gif (recognisable image-like mime but not on the allowlist)', () => {
    const result = validateMediaUpload(
      makeInput({ kind: 'image', mimeType: 'image/gif' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('invalid_format');
    }
  });

  it('rejects an empty mime type', () => {
    const result = validateMediaUpload(
      makeInput({ kind: 'image', mimeType: '' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('invalid_format');
    }
  });

  it('rejects image/jpeg uploaded as video (wrong kind)', () => {
    const result = validateMediaUpload(
      makeInput({ kind: 'video', mimeType: 'image/jpeg' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('invalid_format');
    }
  });

  it('rejects video/mp4 uploaded as image (wrong kind)', () => {
    const result = validateMediaUpload(
      makeInput({ kind: 'image', mimeType: 'video/mp4' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('invalid_format');
    }
  });

  it('rejects model/gltf-binary uploaded as image (wrong kind)', () => {
    const result = validateMediaUpload(
      makeInput({ kind: 'image', mimeType: 'model/gltf-binary' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('invalid_format');
    }
  });
});

describe('validateMediaUpload — file_too_large rejection', () => {
  it('rejects a file 1 byte over the 100 MB ceiling', () => {
    const result = validateMediaUpload(
      makeInput({
        kind: 'image',
        mimeType: 'image/jpeg',
        byteSize: MAX_MEDIA_BYTES + 1,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('file_too_large');
      expect(result.message).toContain('100 MB');
    }
  });

  it('rejects a negative byteSize', () => {
    const result = validateMediaUpload(
      makeInput({ kind: 'image', mimeType: 'image/jpeg', byteSize: -1 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('file_too_large');
    }
  });

  it('rejects a non-finite byteSize', () => {
    const result = validateMediaUpload(
      makeInput({
        kind: 'image',
        mimeType: 'image/png',
        byteSize: Number.POSITIVE_INFINITY,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('file_too_large');
    }
  });

  it('rejects NaN byteSize', () => {
    const result = validateMediaUpload(
      makeInput({ kind: 'video', mimeType: 'video/webm', byteSize: Number.NaN }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('file_too_large');
    }
  });
});

describe('validateMediaUpload — error precedence', () => {
  it('prefers invalid_format over size when mime is unknown', () => {
    const result = validateMediaUpload(
      makeInput({
        kind: 'image',
        mimeType: 'application/octet-stream',
        byteSize: MAX_MEDIA_BYTES + 1,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('invalid_format');
    }
  });

  it('prefers invalid_format over size when mime is for a different kind', () => {
    const result = validateMediaUpload(
      makeInput({
        kind: 'image',
        mimeType: 'video/mp4',
        byteSize: MAX_MEDIA_BYTES + 1,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('invalid_format');
    }
  });
});

describe('validateMediaUpload — purity', () => {
  it('does not mutate the supplied input object', () => {
    const input: MediaUploadInput = Object.freeze({
      kind: 'image',
      mimeType: 'image/jpeg',
      byteSize: 1024,
      filename: 'a.jpg',
    });
    expect(() => validateMediaUpload(input)).not.toThrow();
  });

  it('returns a stable shape across all kinds', () => {
    const kinds: MediaKind[] = ['image', 'video', 'model3d'];
    for (const kind of kinds) {
      const result = validateMediaUpload(
        makeInput({ kind, mimeType: 'application/zip' }),
      );
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(typeof result.code).toBe('string');
        expect(typeof result.message).toBe('string');
      }
    }
  });
});
