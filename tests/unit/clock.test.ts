import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock } from '@/lib/clock';

describe('systemClock', () => {
  it('returns a Date close to the wall clock', () => {
    const before = Date.now();
    const t = systemClock.now();
    const after = Date.now();

    expect(t).toBeInstanceOf(Date);
    expect(t.getTime()).toBeGreaterThanOrEqual(before);
    expect(t.getTime()).toBeLessThanOrEqual(after);
  });

  it('returns a fresh Date each call so callers cannot share mutable state', () => {
    const a = systemClock.now();
    const b = systemClock.now();
    expect(a).not.toBe(b);
  });
});

describe('fixedClock', () => {
  const epoch = new Date('2025-01-01T00:00:00.000Z');

  it('reports the initialised instant deterministically', () => {
    const clock = fixedClock(epoch);

    expect(clock.now().toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('accepts an epoch-millis number', () => {
    const clock = fixedClock(epoch.getTime());
    expect(clock.now().getTime()).toBe(epoch.getTime());
  });

  it('advances the instant by tick(ms)', () => {
    const clock = fixedClock(epoch);
    clock.tick(60_000);

    expect(clock.now().toISOString()).toBe('2025-01-01T00:01:00.000Z');
  });

  it('supports negative ticks', () => {
    const clock = fixedClock(epoch);
    clock.tick(-1_000);

    expect(clock.now().toISOString()).toBe('2024-12-31T23:59:59.000Z');
  });

  it('replaces the instant via set()', () => {
    const clock = fixedClock(epoch);
    clock.set(new Date('2030-06-15T12:00:00.000Z'));

    expect(clock.now().toISOString()).toBe('2030-06-15T12:00:00.000Z');
  });

  it('returns defensive copies so external mutation cannot leak in', () => {
    const clock = fixedClock(epoch);
    const a = clock.now();
    a.setUTCFullYear(1970);
    const b = clock.now();

    expect(b.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('rejects non-finite tick values', () => {
    const clock = fixedClock(epoch);
    expect(() => clock.tick(Number.NaN)).toThrow(RangeError);
    expect(() => clock.tick(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects invalid initial instants', () => {
    expect(() => fixedClock(new Date('not-a-date'))).toThrow(RangeError);
    expect(() => fixedClock(Number.NaN)).toThrow(RangeError);
  });
});
