/**
 * Nominal typing helpers used to brand identifier strings so that, for example,
 * a `ProjectId` cannot be assigned to a `MediaItemId` even though both are
 * structurally `string`s at runtime. The brand is a phantom property keyed by a
 * unique symbol so it never appears in serialized output and carries no
 * runtime cost.
 */

declare const __brand: unique symbol;

/**
 * Brands a base type `T` with a string-literal tag `B` to produce a nominal
 * type. The brand only exists at the type level.
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
