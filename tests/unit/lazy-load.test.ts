/**
 * Unit tests for the responsive-image lazy-load reducer.
 *
 * Covers the explicit transitions required by Task 5.6 (Requirements 4.4,
 * 4.6, 4.7) and the no-op semantics that keep the machine total.
 */

import { describe, expect, it } from "vitest";
import {
  initialLazyState,
  MAX_RETRIES,
  reducer,
  type LazyLoadAction,
  type LazyLoadState,
} from "@/lib/media/lazy-load";

const placeholder: LazyLoadState = { phase: "placeholder", retries: 0 };
const loading: LazyLoadState = { phase: "loading", retries: 0 };
const loaded: LazyLoadState = { phase: "loaded", retries: 0 };
const errored: LazyLoadState = { phase: "error", retries: 0 };

describe("lazy-load reducer: initial state", () => {
  it("starts at idle with zero retries", () => {
    expect(initialLazyState).toEqual({ phase: "idle", retries: 0 });
  });

  it("freezes the initial state singleton", () => {
    expect(Object.isFrozen(initialLazyState)).toBe(true);
  });
});

describe("lazy-load reducer: idle phase", () => {
  it("transitions idle -> placeholder on ENTER_VIEWPORT", () => {
    expect(reducer(initialLazyState, { type: "ENTER_VIEWPORT" })).toEqual(placeholder);
  });

  it("ignores LOAD_STARTED, LOAD_SUCCEEDED, LOAD_FAILED, RETRY while idle", () => {
    const actions: LazyLoadAction[] = [
      { type: "LOAD_STARTED" },
      { type: "LOAD_SUCCEEDED" },
      { type: "LOAD_FAILED" },
      { type: "RETRY" },
      { type: "PLACEHOLDER_RENDERED" },
    ];
    for (const action of actions) {
      expect(reducer(initialLazyState, action)).toBe(initialLazyState);
    }
  });
});

describe("lazy-load reducer: placeholder phase", () => {
  it("transitions placeholder -> loading on LOAD_STARTED", () => {
    expect(reducer(placeholder, { type: "LOAD_STARTED" })).toEqual(loading);
  });

  it("ignores duplicate ENTER_VIEWPORT once placeholder is up", () => {
    expect(reducer(placeholder, { type: "ENTER_VIEWPORT" })).toBe(placeholder);
  });

  it("treats PLACEHOLDER_RENDERED as a no-op acknowledgement", () => {
    expect(reducer(placeholder, { type: "PLACEHOLDER_RENDERED" })).toBe(placeholder);
  });
});

describe("lazy-load reducer: loading phase", () => {
  it("transitions loading -> loaded on LOAD_SUCCEEDED", () => {
    expect(reducer(loading, { type: "LOAD_SUCCEEDED" })).toEqual(loaded);
  });

  it("transitions loading -> error on LOAD_FAILED without changing retries", () => {
    expect(reducer(loading, { type: "LOAD_FAILED" })).toEqual({ phase: "error", retries: 0 });
  });

  it("disallows a second LOAD_STARTED for the same attempt", () => {
    expect(reducer(loading, { type: "LOAD_STARTED" })).toBe(loading);
  });
});

describe("lazy-load reducer: error phase and retry budget", () => {
  it("transitions error -> loading on RETRY and increments retries", () => {
    const next = reducer(errored, { type: "RETRY" });
    expect(next).toEqual({ phase: "loading", retries: 1 });
  });

  it("allows up to MAX_RETRIES retry transitions", () => {
    let state: LazyLoadState = errored;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      state = reducer(state, { type: "RETRY" });
      expect(state).toEqual({ phase: "loading", retries: attempt });
      // simulate the retry attempt failing again
      state = reducer(state, { type: "LOAD_FAILED" });
      expect(state).toEqual({ phase: "error", retries: attempt });
    }
  });

  it("stays in error and does not grow retries past MAX_RETRIES", () => {
    const exhausted: LazyLoadState = { phase: "error", retries: MAX_RETRIES };
    expect(reducer(exhausted, { type: "RETRY" })).toBe(exhausted);
  });
});

describe("lazy-load reducer: loaded is terminal", () => {
  it.each<LazyLoadAction>([
    { type: "ENTER_VIEWPORT" },
    { type: "PLACEHOLDER_RENDERED" },
    { type: "LOAD_STARTED" },
    { type: "LOAD_SUCCEEDED" },
    { type: "LOAD_FAILED" },
    { type: "RETRY" },
  ])("ignores %j once loaded", (action) => {
    expect(reducer(loaded, action)).toBe(loaded);
  });
});

describe("lazy-load reducer: full happy path", () => {
  it("idle -> placeholder -> loading -> loaded", () => {
    let s: LazyLoadState = initialLazyState;
    s = reducer(s, { type: "ENTER_VIEWPORT" });
    expect(s.phase).toBe("placeholder");
    s = reducer(s, { type: "LOAD_STARTED" });
    expect(s.phase).toBe("loading");
    s = reducer(s, { type: "LOAD_SUCCEEDED" });
    expect(s).toEqual({ phase: "loaded", retries: 0 });
  });
});
