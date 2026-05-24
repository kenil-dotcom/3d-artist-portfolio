import { describe, expect, it } from 'vitest';

/**
 * Smoke test that verifies the Vitest harness is wired up.
 *
 * Replaced by real unit tests as later tasks add validators, gallery logic,
 * media variant selection, etc. (Tasks 2.x onwards).
 */
describe('test harness', () => {
  it('runs vitest in jsdom mode', () => {
    expect(typeof window).toBe('object');
    expect(1 + 1).toBe(2);
  });
});
