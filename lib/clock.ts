/**
 * Deterministic clock abstraction.
 *
 * All time-dependent logic (rate-limit windows, retry deadlines, deletion SLAs,
 * consent expiry, etc.) consumes a `Clock` via dependency injection so tests
 * can drive time deterministically.
 *
 * Spec references: Requirements 6.7, 7.8, 12.4, 12.5, 12.7. See also the
 * design note that property tests use a deterministic Clock so timestamps
 * are arbitrary inputs.
 */

export interface Clock {
  /** Returns the current wall-clock time. */
  now(): Date;
}

/**
 * Production clock backed by the host's system time.
 *
 * Always returns a fresh `Date` instance so callers cannot mutate shared state.
 */
export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

/**
 * A test clock that returns a fixed instant unless explicitly advanced or set.
 *
 * Returned `Date` instances are defensive copies, so mutating the result of
 * `now()` cannot affect subsequent reads.
 */
export interface FixedClock extends Clock {
  /** Advance the clock by the given number of milliseconds. May be negative. */
  tick(ms: number): void;
  /** Replace the current instant with the given Date or epoch milliseconds. */
  set(instant: Date | number): void;
}

/**
 * Construct a `FixedClock` initialised to `instant`.
 *
 * @example
 * const clock = fixedClock(new Date('2025-01-01T00:00:00Z'));
 * clock.now();        // -> 2025-01-01T00:00:00Z
 * clock.tick(60_000);
 * clock.now();        // -> 2025-01-01T00:01:00Z
 */
export function fixedClock(instant: Date | number): FixedClock {
  let current = toDate(instant);

  return {
    now(): Date {
      return new Date(current.getTime());
    },
    tick(ms: number): void {
      if (!Number.isFinite(ms)) {
        throw new RangeError(`fixedClock.tick(ms) requires a finite number, got ${String(ms)}`);
      }
      current = new Date(current.getTime() + ms);
    },
    set(next: Date | number): void {
      current = toDate(next);
    },
  };
}

function toDate(instant: Date | number): Date {
  if (typeof instant === 'number') {
    if (!Number.isFinite(instant)) {
      throw new RangeError(`fixedClock requires a finite epoch ms, got ${String(instant)}`);
    }
    return new Date(instant);
  }
  const ms = instant.getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError('fixedClock requires a valid Date');
  }
  return new Date(ms);
}
