/**
 * ResponsiveImage — minimal server-rendered image wrapper.
 *
 * The full media pipeline (variants per breakpoint, AVIF/WebP negotiation,
 * IntersectionObserver-driven lazy load) is deferred to a later task. This
 * thin wrapper renders a single `<img>` against a CDN/Picsum URL with:
 *   - `loading="lazy"` for off-screen deferral by the browser.
 *   - `decoding="async"` so layout is not blocked on decode.
 *   - A CSS-based blur placeholder until the asset paints.
 *
 * Spec references:
 *   - Requirement 4.4 (lazy load images outside the viewport).
 *   - Requirement 4.6 (placeholder while the asset is loading).
 *   - Requirement 10.4 (`alt` text required for image media).
 */

import type { CSSProperties } from 'react';

interface ResponsiveImageProps {
  /** Absolute or root-relative URL to the image asset. */
  readonly src: string;
  /** Accessible alternative text. Required at the type level (Req 10.4). */
  readonly alt: string;
  /** Intrinsic width of the source image, used to reserve layout space. */
  readonly width: number;
  /** Intrinsic height of the source image, used to reserve layout space. */
  readonly height: number;
  /** Optional sizing class (e.g. `object-cover h-full w-full`). */
  readonly className?: string;
  /**
   * Fetch priority hint. `eager` skips the lazy-load deferral for above-the-
   * fold imagery (Hero, first gallery tile).
   */
  readonly priority?: boolean;
}

const PLACEHOLDER_STYLE: CSSProperties = {
  // Soft neutral blur block; visible until the image paints over it.
  background:
    'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
};

export function ResponsiveImage({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
}: ResponsiveImageProps): JSX.Element {
  const loading = priority ? 'eager' : 'lazy';
  const classes = ['responsive-image', className ?? ''].filter(Boolean).join(' ');

  return (
    <span
      className="responsive-image-frame"
      style={PLACEHOLDER_STYLE}
      data-priority={priority ? 'true' : 'false'}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding="async"
        className={classes}
      />
    </span>
  );
}

export default ResponsiveImage;
