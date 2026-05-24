'use client';

/**
 * Reveal — scroll-triggered entrance animation.
 *
 * Wraps any block of content in a wrapper that starts at `opacity: 0`,
 * `translateY(24px)` and animates to its natural position using Apple's
 * signature ease-out-quart curve (`cubic-bezier(0.16, 1, 0.3, 1)`) when
 * the element scrolls into the viewport.
 *
 * Implementation notes:
 *   - Uses a single shared `IntersectionObserver` (per component instance)
 *     and disconnects after the first intersection so the animation only
 *     plays once.
 *   - Falls back to immediately revealing the content when
 *     `IntersectionObserver` is unavailable (older browsers, JSDOM in
 *     tests).
 *   - Honours `prefers-reduced-motion` via the corresponding CSS rule in
 *     `app/globals.css` — no JS branch is needed because the CSS rule
 *     short-circuits the animation by skipping the transform delta.
 *
 * Props:
 *   - `delay`     — ms of delay before the animation starts. Apple stacks
 *                    multiple reveals with 60-120 ms staggers; pass that
 *                    here for siblings.
 *   - `as`        — element tag, defaults to `div`.
 *   - `className` — additional classes appended after the `reveal` base.
 *   - `once`      — when `false`, the element re-enters every time it
 *                    scrolls back into view. Defaults to `true`.
 */

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

interface RevealProps {
  readonly children: ReactNode;
  readonly delay?: number;
  readonly as?: ElementType;
  readonly className?: string;
  readonly once?: boolean;
  readonly style?: CSSProperties;
}

export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
  once = true,
  style,
}: RevealProps): JSX.Element {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;

    // Older browsers / SSR snapshots — reveal immediately.
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('reveal-in');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal-in');
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            entry.target.classList.remove('reveal-in');
          }
        }
      },
      {
        // Trigger slightly before the element fully enters the viewport.
        threshold: 0.12,
        rootMargin: '0px 0px -8% 0px',
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [once]);

  const mergedStyle: CSSProperties = {
    transitionDelay: `${delay}ms`,
    ...style,
  };

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${className}`.trim()}
      style={mergedStyle}
    >
      {children}
    </Tag>
  );
}

export default Reveal;
