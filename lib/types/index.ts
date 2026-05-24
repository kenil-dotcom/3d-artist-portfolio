/**
 * Barrel re-export for the core domain, inquiry, and CMS types.
 *
 * Prefer importing from `@/lib/types` over the individual module paths so
 * that a single import covers the related vocabulary.
 */

export * from "./brand";
export * from "./domain";
export * from "./inquiry";
export * from "./cms";
