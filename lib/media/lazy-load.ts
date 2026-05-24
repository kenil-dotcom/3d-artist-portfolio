/**
 * Pure state reducer for the responsive image lazy-load pipeline used by
 * `ResponsiveImage`. Models the placeholder/load lifecycle for a single
 * media item so the rendering layer can be thin: it dispatches events and
 * renders whatever the current state describes.
 *
 * Spec references:
 * - Requirement 4.4: defer load until the element is within 200 px of the
 *   viewport, then begin loading.
 * - Requirement 4.6: show a placeholder once the element enters the
 *   viewport and keep it visible until the full asset has loaded.
 * - Requirement 4.7: on load failure or 15 s timeout, surface a retry
 *   indicator and allow up to 3 manual retries per item, preserving layout.
 *
 * The reducer is intentionally side-effect free. Timeouts, IntersectionObserver
 * wiring, and `<img>` event listeners are the calling component's job; this
 * module only computes the next state from a current state and an action,
 * which makes it trivial to exercise from unit and property-based tests.
 *
 * State machine (the only legal transitions):
 *
 *   idle --------- ENTER_VIEWPORT ------> placeholder
 *   placeholder -- LOAD_STARTED --------> loading
 *   loading ------ LOAD_SUCCEEDED ------> loaded         (terminal)
 *   loading ------ LOAD_FAILED ---------> error          (retries unchanged)
 *   error -------- RETRY ---------------> loading        (retries + 1, only if retries < 3)
 *   error -------- RETRY ---------------> error          (no-op when retries >= 3)
 *
 * `loaded` is terminal: every action is a no-op. Every other unspecified
 * (state, action) pair is also a no-op so the reducer is total.
 *
 * `PLACEHOLDER_RENDERED` is acknowledged as a valid action so callers can
 * dispatch it as a confirmation that the placeholder DOM is present, but it
 * does not advance the machine on its own — the placeholder phase already
 * implies the placeholder is visible per Requirement 4.6.
 */

/**
 * Lifecycle phases of a single media item being lazy-loaded.
 *
 * - `idle`: not yet in or near the viewport; nothing rendered.
 * - `placeholder`: within 200 px of the viewport; LQIP / dominant-color
 *   block rendered (Requirement 4.6).
 * - `loading`: full-resolution fetch in flight; placeholder still visible.
 * - `loaded`: full-resolution asset has finished decoding; terminal.
 * - `error`: load failed or timed out; retry control offered up to 3 times
 *   (Requirement 4.7).
 */
export type LazyLoadPhase = "idle" | "placeholder" | "loading" | "loaded" | "error";

/**
 * Reducer state. `retries` counts the number of completed retry transitions
 * (`error -> loading`); it is capped at 3 by the reducer.
 */
export interface LazyLoadState {
  readonly phase: LazyLoadPhase;
  readonly retries: number;
}

/**
 * The maximum number of manual retry attempts allowed per media item
 * (Requirement 4.7).
 */
export const MAX_RETRIES = 3;

/**
 * Reducer actions. Each action is a discriminated union member whose `type`
 * field uniquely identifies the transition the caller intends to drive.
 *
 * `LOAD_FAILED` covers both transport/server errors and the 15-second
 * timeout enforced by `ResponsiveImage`; the reducer treats them
 * identically because the resulting state and retry semantics are the same.
 */
export type LazyLoadAction =
  | { readonly type: "ENTER_VIEWPORT" }
  | { readonly type: "PLACEHOLDER_RENDERED" }
  | { readonly type: "LOAD_STARTED" }
  | { readonly type: "LOAD_SUCCEEDED" }
  | { readonly type: "LOAD_FAILED" }
  | { readonly type: "RETRY" };

/**
 * Initial state for a freshly mounted media item.
 *
 * Frozen so consumers cannot accidentally mutate the shared singleton; the
 * reducer always returns fresh objects on real transitions and the same
 * reference (often `state` itself) on no-ops.
 */
export const initialLazyState: LazyLoadState = Object.freeze({
  phase: "idle",
  retries: 0,
});

/**
 * Pure state transition function.
 *
 * Returns a new `LazyLoadState` for legal transitions and the input
 * `state` reference unchanged for no-ops. This referential-equality
 * guarantee lets React-style consumers cheaply skip re-renders when an
 * action did not actually move the machine.
 */
export function reducer(state: LazyLoadState, action: LazyLoadAction): LazyLoadState {
  // `loaded` is terminal: every action is a no-op once the asset is loaded.
  if (state.phase === "loaded") {
    return state;
  }

  switch (action.type) {
    case "ENTER_VIEWPORT": {
      // Only meaningful while idle; re-entering the viewport after the
      // placeholder is up or the load is in flight should not reset state.
      if (state.phase === "idle") {
        return { phase: "placeholder", retries: state.retries };
      }
      return state;
    }

    case "PLACEHOLDER_RENDERED": {
      // Acknowledgement only — the placeholder phase already implies the
      // placeholder is on-screen, so there is no state change to make.
      return state;
    }

    case "LOAD_STARTED": {
      // Begin the fetch only from the placeholder phase. Disallowing
      // `loading -> loading` enforces the design's "single LOAD_STARTED per
      // attempt" property.
      if (state.phase === "placeholder") {
        return { phase: "loading", retries: state.retries };
      }
      return state;
    }

    case "LOAD_SUCCEEDED": {
      if (state.phase === "loading") {
        return { phase: "loaded", retries: state.retries };
      }
      return state;
    }

    case "LOAD_FAILED": {
      // Transport error or 15 s timeout (Requirement 4.7). The retry
      // counter is *not* incremented here — only a successful RETRY
      // transition advances it, so a single failure followed by no retry
      // leaves `retries` at zero.
      if (state.phase === "loading") {
        return { phase: "error", retries: state.retries };
      }
      return state;
    }

    case "RETRY": {
      // Retry budget is capped at MAX_RETRIES (Requirement 4.7). Once
      // exhausted, the state stays in `error` and `retries` does not grow
      // beyond MAX_RETRIES.
      if (state.phase === "error" && state.retries < MAX_RETRIES) {
        return { phase: "loading", retries: state.retries + 1 };
      }
      return state;
    }

    default: {
      // Exhaustiveness guard: if a new action variant is added to
      // `LazyLoadAction`, TypeScript will surface this branch as an error
      // at the call site rather than silently dropping the action.
      assertNever(action);
      return state;
    }
  }
}

/**
 * Helper used in the reducer's exhaustiveness guard. Narrowing `x` to
 * `never` makes adding a new action variant without handling it a compile
 * error.
 */
function assertNever(x: never): never {
  throw new Error(`lazy-load reducer: unexpected action ${JSON.stringify(x)}`);
}
