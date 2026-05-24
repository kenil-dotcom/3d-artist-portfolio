import { describe, expect, it } from 'vitest';
import {
  BIO_LIMITS,
  BIO_PROFILE_IMAGE_MIMES,
  BIO_RESUME_MIME,
  validateBioHeader,
  validateBioInput,
} from '@/lib/validation/bio';

describe('validateBioHeader', () => {
  it('accepts a minimal valid header', () => {
    const result = validateBioHeader('A', 'A');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ artistName: 'A', tagline: 'A' });
    }
  });

  it('accepts the maximum length boundaries', () => {
    const name = 'a'.repeat(BIO_LIMITS.artistNameMax);
    const tagline = 'b'.repeat(BIO_LIMITS.taglineMax);
    const result = validateBioHeader(name, tagline);
    expect(result.ok).toBe(true);
  });

  it('rejects an empty artist name with the required code', () => {
    const result = validateBioHeader('', 'ok');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'artistName', code: 'required' })
      );
    }
  });

  it('rejects an over-long artist name with length_max', () => {
    const tooLong = 'a'.repeat(BIO_LIMITS.artistNameMax + 1);
    const result = validateBioHeader(tooLong, 'ok');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'artistName', code: 'length_max' })
      );
    }
  });

  it('rejects an over-long tagline with length_max', () => {
    const tooLong = 'b'.repeat(BIO_LIMITS.taglineMax + 1);
    const result = validateBioHeader('ok', tooLong);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'tagline', code: 'length_max' })
      );
    }
  });

  it.each([
    ['line\nbreak'],
    ['carriage\rreturn'],
    ['both\r\nhere'],
  ])('rejects taglines containing line breaks (%s)', (tagline) => {
    const result = validateBioHeader('ok', tagline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'tagline',
          code: 'forbidden_newline',
        })
      );
    }
  });

  it('reports both name and tagline errors in a single call', () => {
    const result = validateBioHeader('', '');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain('artistName');
      expect(fields).toContain('tagline');
    }
  });

  it('rejects non-string inputs with type_invalid', () => {
    const result = validateBioHeader(42, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'artistName', code: 'type_invalid' })
      );
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'tagline', code: 'type_invalid' })
      );
    }
  });
});

const VALID_PROFILE_IMAGE = {
  storageKey: 'media/2024/profile.jpg',
  contentHash: 'a'.repeat(64),
  mimeType: 'image/jpeg' as const,
  width: 800,
  height: 800,
  durationSec: null,
  byteSize: 200_000,
};

const VALID_RESUME = {
  storageKey: 'media/2024/cv.pdf',
  contentHash: 'b'.repeat(64),
  mimeType: BIO_RESUME_MIME,
  width: null,
  height: null,
  durationSec: null,
  byteSize: 1_000_000,
};

const VALID_BIO_INPUT = {
  artistName: 'Ada Render',
  tagline: '3D environments and characters.',
  biography: 'A short bio.',
  profileImage: VALID_PROFILE_IMAGE,
  skills: ['Modeling', 'Lighting'],
  software: ['Blender'],
  socialLinks: [
    {
      id: 'sl-1',
      platform: 'ArtStation',
      url: 'https://www.artstation.com/ada',
      ordering: 0,
    },
  ],
  resume: VALID_RESUME,
};

describe('validateBioInput', () => {
  it('accepts a fully populated, valid bio input', () => {
    const result = validateBioInput(VALID_BIO_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artistName).toBe('Ada Render');
      expect(result.value.skills).toEqual(['Modeling', 'Lighting']);
      expect(result.value.profileImage?.mimeType).toBe('image/jpeg');
      expect(result.value.resume?.mimeType).toBe(BIO_RESUME_MIME);
    }
  });

  it('accepts profileImage and resume null', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      profileImage: null,
      resume: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profileImage).toBeNull();
      expect(result.value.resume).toBeNull();
    }
  });

  it('accepts empty skills, software, and social links lists', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      skills: [],
      software: [],
      socialLinks: [],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an empty biography (0 chars is the lower bound)', () => {
    const result = validateBioInput({ ...VALID_BIO_INPUT, biography: '' });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object payload', () => {
    const result = validateBioInput(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'input', code: 'type_invalid' })
      );
    }
  });

  it('rejects an over-long biography with length_max', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      biography: 'x'.repeat(BIO_LIMITS.biographyMax + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'biography', code: 'length_max' })
      );
    }
  });

  it('rejects more than 30 skills with array_max', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      skills: Array.from({ length: BIO_LIMITS.skillsMax + 1 }, (_, i) => `skill-${i}`),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'skills', code: 'array_max' })
      );
    }
  });

  it('reports the offending index for an empty skill entry', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      skills: ['Modeling', ''],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'skills[1]', code: 'required' })
      );
    }
  });

  it('rejects software entries longer than the per-entry max', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      software: ['x'.repeat(BIO_LIMITS.softwareEntryMax + 1)],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'software[0]',
          code: 'length_max',
        })
      );
    }
  });

  it('rejects more than 15 social links with array_max', () => {
    const links = Array.from({ length: BIO_LIMITS.socialLinksMax + 1 }, (_, i) => ({
      id: `sl-${i}`,
      platform: 'ArtStation',
      url: `https://example.com/${i}`,
      ordering: i,
    }));
    const result = validateBioInput({ ...VALID_BIO_INPUT, socialLinks: links });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'socialLinks', code: 'array_max' })
      );
    }
  });

  it.each([
    ['http://example.com'],
    ['ftp://example.com'],
    ['not-a-url'],
    [''],
  ])('rejects social link URLs that are not https (%s)', (url) => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      socialLinks: [
        { id: 'sl-1', platform: 'X', url, ordering: 0 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors
        .filter((e) => e.field === 'socialLinks[0].url')
        .map((e) => e.code);
      // Empty string emits `required`, others emit `url_invalid`.
      expect(codes.length).toBeGreaterThan(0);
    }
  });

  it('rejects social link URLs longer than 2048 with url_max', () => {
    const url = 'https://example.com/' + 'a'.repeat(BIO_LIMITS.socialUrlMax);
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      socialLinks: [
        { id: 'sl-1', platform: 'X', url, ordering: 0 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'socialLinks[0].url',
          code: 'url_max',
        })
      );
    }
  });

  it.each(BIO_PROFILE_IMAGE_MIMES)(
    'accepts profile image MIME %s',
    (mime) => {
      const result = validateBioInput({
        ...VALID_BIO_INPUT,
        profileImage: { ...VALID_PROFILE_IMAGE, mimeType: mime },
      });
      expect(result.ok).toBe(true);
    }
  );

  it('rejects a profile image with a disallowed MIME', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      profileImage: { ...VALID_PROFILE_IMAGE, mimeType: 'image/gif' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'profileImage.mimeType',
          code: 'mime_unsupported',
        })
      );
    }
  });

  it('rejects a resume that is not application/pdf', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      resume: { ...VALID_RESUME, mimeType: 'application/octet-stream' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'resume.mimeType',
          code: 'mime_unsupported',
        })
      );
    }
  });

  it('rejects a resume larger than 20 MB with file_too_large', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      resume: {
        ...VALID_RESUME,
        byteSize: BIO_LIMITS.resumeMaxBytes + 1,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'resume.byteSize',
          code: 'file_too_large',
        })
      );
    }
  });

  it('accepts a resume exactly at the size limit', () => {
    const result = validateBioInput({
      ...VALID_BIO_INPUT,
      resume: { ...VALID_RESUME, byteSize: BIO_LIMITS.resumeMaxBytes },
    });
    expect(result.ok).toBe(true);
  });

  it('accumulates multiple distinct errors in a single call', () => {
    const result = validateBioInput({
      artistName: '',
      tagline: 'has\nnewline',
      biography: 'x'.repeat(BIO_LIMITS.biographyMax + 1),
      profileImage: { ...VALID_PROFILE_IMAGE, mimeType: 'image/gif' },
      skills: ['', 'ok'],
      software: [],
      socialLinks: [
        { id: 'sl-1', platform: '', url: 'http://nope', ordering: 0 },
      ],
      resume: { ...VALID_RESUME, byteSize: BIO_LIMITS.resumeMaxBytes + 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fieldCodePairs = result.errors.map((e) => `${e.field}:${e.code}`);
      expect(fieldCodePairs).toEqual(
        expect.arrayContaining([
          'artistName:required',
          'tagline:forbidden_newline',
          'biography:length_max',
          'profileImage.mimeType:mime_unsupported',
          'skills[0]:required',
          'socialLinks[0].platform:required',
          'socialLinks[0].url:url_invalid',
          'resume.byteSize:file_too_large',
        ])
      );
    }
  });
});
