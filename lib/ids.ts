/**
 * Deterministic id generator abstraction.
 *
 * All id-dependent logic (project ids, inquiry ids, media item ids, job ids,
 * etc.) consumes an `IdGenerator` via dependency injection so property and
 * unit tests can drive id generation deterministically.
 *
 * Spec references: Requirements 6.7, 7.8, 12.4, 12.5, 12.7 (rate-limit,
 * deletion, consent persistence). The design's testing strategy notes that
 * generators must produce deterministic outputs for property-based tests.
 */

export interface IdGenerator {
  /** Returns an RFC 4122 v4 UUID string in canonical lowercase form. */
  uuid(): string;
}

/**
 * Production id generator backed by the host platform's CSPRNG.
 *
 * Uses `globalThis.crypto.randomUUID()` so it works uniformly across the
 * Node.js, Edge, and browser runtimes Next.js targets.
 */
export const cryptoIdGenerator: IdGenerator = {
  uuid(): string {
    const c = globalThis.crypto;
    if (!c || typeof c.randomUUID !== 'function') {
      throw new Error(
        'cryptoIdGenerator requires globalThis.crypto.randomUUID; running in an unsupported runtime',
      );
    }
    return c.randomUUID();
  },
};

/**
 * A deterministic, seedable id generator for tests.
 *
 * Produces RFC 4122 v4-shaped UUIDs whose random bits come from a Mulberry32
 * PRNG. Identical seeds yield identical sequences across runs and platforms,
 * which is the property tests rely on.
 *
 * NOTE: Not cryptographically secure. Never use in production code paths.
 */
export interface SeededIdGenerator extends IdGenerator {
  /** Reset the internal PRNG to the given seed. */
  reset(seed: number): void;
}

/**
 * Construct a `SeededIdGenerator` initialised with `seed` (default `1`).
 */
export function seededIdGenerator(seed: number = 1): SeededIdGenerator {
  if (!Number.isFinite(seed)) {
    throw new RangeError(`seededIdGenerator requires a finite seed, got ${String(seed)}`);
  }
  let rng = mulberry32(seed >>> 0);

  return {
    uuid(): string {
      return formatUuidV4(fillBytes16(rng));
    },
    reset(nextSeed: number): void {
      if (!Number.isFinite(nextSeed)) {
        throw new RangeError(
          `seededIdGenerator.reset requires a finite seed, got ${String(nextSeed)}`,
        );
      }
      rng = mulberry32(nextSeed >>> 0);
    },
  };
}

/**
 * Mulberry32 PRNG: a tiny, fast, 32-bit-state generator with good distribution
 * for non-cryptographic use. Returns a function yielding floats in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let r = state;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function fillBytes16(rng: () => number): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(rng() * 256) & 0xff;
  }
  // Set the version (4) in the high nibble of byte 6.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  // Set the variant (RFC 4122) in the high two bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return bytes;
}

function formatUuidV4(bytes: Uint8Array): string {
  const hex: string[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    hex[i] = (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
