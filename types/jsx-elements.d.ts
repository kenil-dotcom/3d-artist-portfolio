/**
 * JSX intrinsic-element augmentations for non-standard / custom elements
 * the public renderer relies on.
 *
 * `<model-viewer>` is the Google web component (loaded from unpkg) used by
 * `app/projects/[slug]/page.tsx` to display `glb` / `gltf` Section_Blocks
 * with built-in AR support (Requirement 16.9). The element ships its own
 * runtime as a `<script type="module">` tag injected by the page when at
 * least one renderable model3d block is present on the project; this file
 * exists purely to teach TypeScript that the tag is a valid JSX element.
 *
 * Every attribute is optional so authors can compose the affordances they
 * need (`ar`, `camera-controls`, `auto-rotate`) without TypeScript
 * complaining about missing required props.
 */

import type * as React from 'react';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          poster?: string;
          // The model-viewer component treats the bare attribute name as
          // truthy ("ar") so we permit both the boolean form (`ar`) and
          // the empty-string form (`ar=""`) JSX serialises to.
          ar?: boolean | '';
          'ar-modes'?: string;
          'ios-src'?: string;
          'camera-controls'?: boolean | '';
          'auto-rotate'?: boolean | '';
        },
        HTMLElement
      >;
    }
  }
}

export {};
