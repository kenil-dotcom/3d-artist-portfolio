'use client';

/**
 * CustomCursor — playful, teasing trailing cursor.
 *
 * Layout:
 *   - A small accent-coloured **dot** that hugs the actual pointer with a
 *     tight lerp (the "you are here" beacon, blended over imagery using
 *     mix-blend-mode: difference for legibility).
 *   - A larger outlined **ring** that lags behind with a slower lerp.
 *     Morphs in size and colour when hovering interactive elements.
 *   - A pill-shaped **label** anchored next to the cursor that surfaces
 *     short teasing copy like "peek inside" on tile cards or any
 *     `data-cursor-label="…"` element.
 *
 * Behaviour:
 *   - Disabled on touch / coarse-pointer devices (mobile + tablets).
 *   - Disabled when `prefers-reduced-motion: reduce` is set.
 *   - When the visitor hovers a text-input field, the custom cursor fades
 *     out so the native I-beam can take over without visual conflict.
 *   - Click bursts the ring inward briefly to acknowledge the press.
 *
 * The component intentionally manipulates DOM nodes via refs and
 * `requestAnimationFrame` rather than React state — sub-frame mouse
 * tracking would otherwise force a re-render every frame, which is
 * wasteful and causes input lag.
 */

import { useEffect, useRef, type ReactElement } from 'react';

// ---------------------------------------------------------------------------
// Auto-label vocabulary
// ---------------------------------------------------------------------------

const TILE_TEASES: ReadonlyArray<string> = [
  'peek inside',
  'have a look',
  'open it',
  'come closer',
  'see more',
  'go in',
];

const SUBMIT_TEASES: ReadonlyArray<string> = [
  'send it',
  "let's go",
  'go on',
];

function pickRandom(list: ReadonlyArray<string>): string | null {
  if (list.length === 0) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx] ?? null;
}

/**
 * Resolve a teasing label for a given interactive element. An explicit
 * `data-cursor-label="…"` always wins; otherwise we fall back to a
 * random pick from the tile / submit vocabulary based on the class list.
 */
function resolveLabel(el: HTMLElement): string | null {
  const explicit = el.closest<HTMLElement>('[data-cursor-label]');
  if (explicit !== null) {
    const value = explicit.getAttribute('data-cursor-label');
    if (value !== null && value.length > 0) return value;
  }
  if (el.closest('.tile-card') !== null) return pickRandom(TILE_TEASES);
  if (el.closest('button[type="submit"]') !== null) return pickRandom(SUBMIT_TEASES);
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CustomCursor(): ReactElement | null {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const dot = dotRef.current;
    const ring = ringRef.current;
    const label = labelRef.current;
    if (dot === null || ring === null || label === null) return;

    // Skip on touch-only devices and when motion is reduced.
    const supportsFinePointer = window.matchMedia('(pointer: fine)').matches;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!supportsFinePointer || reducedMotion) return;

    document.body.dataset.cursorActive = 'true';

    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let dotX = pointerX;
    let dotY = pointerY;
    let ringX = pointerX;
    let ringY = pointerY;
    let firstMove = true;
    let rafId = 0;
    let hoveredInteractive: HTMLElement | null = null;

    const tick = (): void => {
      // Lerp factors. Dot is tight (snappy beacon); ring lags (heavier
      // satellite) — Apple uses a similar split between cursor and chrome
      // animation tracks for that "weight" feel.
      const dotEase = 0.36;
      const ringEase = 0.18;

      dotX += (pointerX - dotX) * dotEase;
      dotY += (pointerY - dotY) * dotEase;
      ringX += (pointerX - ringX) * ringEase;
      ringY += (pointerY - ringY) * ringEase;

      dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0)`;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      label.style.transform = `translate3d(${dotX + 18}px, ${dotY + 22}px, 0)`;

      rafId = window.requestAnimationFrame(tick);
    };

    const handlePointerMove = (event: PointerEvent): void => {
      pointerX = event.clientX;
      pointerY = event.clientY;

      if (firstMove) {
        // Snap immediately on first sighting so the cursor doesn't sweep
        // across the screen from its centre origin.
        dotX = pointerX;
        dotY = pointerY;
        ringX = pointerX;
        ringY = pointerY;
        firstMove = false;
      }

      const target =
        event.target instanceof HTMLElement ? event.target : null;

      // Detect text inputs first; over them we hand off to the native cursor.
      const overTextInput =
        target !== null &&
        target.closest(
          'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]), textarea, select, [contenteditable="true"]',
        ) !== null;
      document.body.dataset.cursorMode = overTextInput ? 'text' : 'normal';

      // Determine the strongest interactive ancestor.
      const strongHover =
        target !== null
          ? target.closest<HTMLElement>('.tile-card, [data-cursor-label]')
          : null;
      const subtleHover =
        target !== null
          ? target.closest<HTMLElement>('a, button, [role="button"], .chip')
          : null;

      const nextHover = strongHover ?? subtleHover ?? null;

      if (nextHover !== hoveredInteractive) {
        hoveredInteractive = nextHover;

        if (strongHover !== null) {
          ring.dataset.state = 'strong';
          const text = resolveLabel(strongHover);
          if (text !== null) {
            label.textContent = text;
            label.dataset.state = 'visible';
          } else {
            label.dataset.state = 'hidden';
          }
        } else if (subtleHover !== null) {
          ring.dataset.state = 'subtle';
          label.dataset.state = 'hidden';
        } else {
          ring.dataset.state = 'idle';
          label.dataset.state = 'hidden';
        }
      }
    };

    const handlePointerDown = (): void => {
      ring.dataset.click = 'true';
    };
    const handlePointerUp = (): void => {
      ring.dataset.click = 'false';
    };

    const handleViewportLeave = (): void => {
      // Fade out when the pointer leaves the document so we don't pin a
      // stale cursor at the edge.
      document.body.dataset.cursorVisible = 'false';
      label.dataset.state = 'hidden';
    };
    const handleViewportEnter = (): void => {
      document.body.dataset.cursorVisible = 'true';
    };

    document.body.dataset.cursorVisible = 'true';
    rafId = window.requestAnimationFrame(tick);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    document.addEventListener('mouseleave', handleViewportLeave);
    document.addEventListener('mouseenter', handleViewportEnter);

    return (): void => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('mouseleave', handleViewportLeave);
      document.removeEventListener('mouseenter', handleViewportEnter);
      delete document.body.dataset.cursorActive;
      delete document.body.dataset.cursorMode;
      delete document.body.dataset.cursorVisible;
    };
  }, []);

  return (
    <>
      <div
        ref={dotRef}
        className="custom-cursor-dot"
        aria-hidden="true"
      />
      <div
        ref={ringRef}
        className="custom-cursor-ring"
        aria-hidden="true"
        data-state="idle"
        data-click="false"
      />
      <div
        ref={labelRef}
        className="custom-cursor-label"
        aria-hidden="true"
        data-state="hidden"
      >
        peek inside
      </div>
    </>
  );
}

export default CustomCursor;
