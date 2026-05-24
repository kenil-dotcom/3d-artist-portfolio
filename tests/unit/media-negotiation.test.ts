import { describe, expect, it } from 'vitest';
import { chooseImageFormat, pickVariant } from '@/lib/media/format';
import type { ImageVariant } from '@/lib/media/types';

const v = (width: number, format: ImageVariant['format'] = 'jpeg', bytes = width * 100): ImageVariant => ({
  url: `https://cdn.example.com/${format}/${width}.${format}`,
  width,
  format,
  bytes,
});

describe('chooseImageFormat', () => {
  it('returns "avif" when image/avif is explicitly accepted', () => {
    expect(chooseImageFormat('image/avif,image/webp,image/*;q=0.8')).toBe('avif');
  });

  it('returns "webp" when image/avif is missing but image/webp is accepted', () => {
    expect(chooseImageFormat('image/webp,image/png,image/jpeg')).toBe('webp');
  });

  it('returns "jpeg" when neither modern format is advertised', () => {
    expect(chooseImageFormat('image/png,image/jpeg')).toBe('jpeg');
  });

  it('treats "*/*" as no preference and falls back to jpeg', () => {
    expect(chooseImageFormat('*/*')).toBe('jpeg');
  });

  it('treats "image/*" wildcards as no preference and falls back to jpeg', () => {
    expect(chooseImageFormat('image/*')).toBe('jpeg');
  });

  it('respects q=0 by skipping that subtype', () => {
    // q=0 means "explicitly not accepted"; should fall through to webp.
    expect(chooseImageFormat('image/avif;q=0,image/webp,image/jpeg')).toBe('webp');
    // Both modern types disabled -> jpeg.
    expect(chooseImageFormat('image/avif;q=0,image/webp;q=0,image/jpeg')).toBe('jpeg');
  });

  it('is case-insensitive', () => {
    expect(chooseImageFormat('IMAGE/AVIF, IMAGE/WEBP')).toBe('avif');
  });

  it('returns "jpeg" for empty or whitespace-only headers', () => {
    expect(chooseImageFormat('')).toBe('jpeg');
    expect(chooseImageFormat('   ')).toBe('jpeg');
  });

  it('ignores malformed entries without breaking the rest of the header', () => {
    expect(chooseImageFormat('garbage,,image/avif')).toBe('avif');
  });
});

describe('pickVariant', () => {
  const variants: ImageVariant[] = [v(320), v(640), v(1280), v(1920)];

  it('returns the smallest variant whose width is >= the viewport', () => {
    expect(pickVariant(variants, 700).width).toBe(1280);
  });

  it('matches exactly when a variant has the requested width', () => {
    expect(pickVariant(variants, 640).width).toBe(640);
  });

  it('returns the largest variant when none are wide enough', () => {
    expect(pickVariant(variants, 4000).width).toBe(1920);
  });

  it('returns the smallest available variant for tiny viewports', () => {
    expect(pickVariant(variants, 1).width).toBe(320);
  });

  it('handles non-positive or non-finite viewports by returning the smallest variant', () => {
    expect(pickVariant(variants, 0).width).toBe(320);
    expect(pickVariant(variants, -100).width).toBe(320);
    expect(pickVariant(variants, Number.NaN).width).toBe(320);
  });

  it('breaks ties by preferring the earlier-listed variant', () => {
    const tied: ImageVariant[] = [v(800, 'avif'), v(800, 'webp'), v(800, 'jpeg')];
    expect(pickVariant(tied, 800).format).toBe('avif');
  });

  it('throws when given an empty list', () => {
    expect(() => pickVariant([], 800)).toThrow(/must not be empty/);
  });

  it('works with a single variant', () => {
    const only = [v(512)];
    expect(pickVariant(only, 100)).toBe(only[0]);
    expect(pickVariant(only, 5000)).toBe(only[0]);
  });
});
