import { describe, expect, it } from 'vitest';
import { cryptoIdGenerator, seededIdGenerator } from '@/lib/ids';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('cryptoIdGenerator', () => {
  it('produces canonical v4 UUIDs', () => {
    const id = cryptoIdGenerator.uuid();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('produces distinct ids on subsequent calls', () => {
    const a = cryptoIdGenerator.uuid();
    const b = cryptoIdGenerator.uuid();
    expect(a).not.toBe(b);
  });
});

describe('seededIdGenerator', () => {
  it('produces canonical v4 UUIDs', () => {
    const gen = seededIdGenerator(42);
    for (let i = 0; i < 50; i++) {
      expect(gen.uuid()).toMatch(UUID_V4_REGEX);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = seededIdGenerator(123);
    const b = seededIdGenerator(123);

    const aIds = Array.from({ length: 10 }, () => a.uuid());
    const bIds = Array.from({ length: 10 }, () => b.uuid());

    expect(aIds).toEqual(bIds);
  });

  it('produces different sequences for different seeds', () => {
    const a = seededIdGenerator(1);
    const b = seededIdGenerator(2);

    expect(a.uuid()).not.toBe(b.uuid());
  });

  it('reset(seed) restarts the sequence', () => {
    const gen = seededIdGenerator(7);
    const first = gen.uuid();
    gen.uuid();
    gen.uuid();

    gen.reset(7);
    expect(gen.uuid()).toBe(first);
  });

  it('produces a long run of distinct ids in practice', () => {
    const gen = seededIdGenerator(99);
    const ids = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      ids.add(gen.uuid());
    }
    expect(ids.size).toBe(1_000);
  });

  it('rejects non-finite seeds', () => {
    expect(() => seededIdGenerator(Number.NaN)).toThrow(RangeError);
    expect(() => seededIdGenerator(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    const gen = seededIdGenerator(1);
    expect(() => gen.reset(Number.NaN)).toThrow(RangeError);
  });
});
