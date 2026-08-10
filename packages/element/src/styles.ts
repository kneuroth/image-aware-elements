/**
 * Shadow-DOM stylesheet for `<image-surface>`.
 *
 * Two rules here are load-bearing rather than cosmetic:
 *
 * - `transform-origin: 0 0` on a surface. The homography maps the design rect's
 *   *top-left* onto the marked corner. Any other origin silently offsets
 *   everything.
 * - No `perspective` anywhere. The projective divide is already inside the
 *   matrix; a `perspective` on an ancestor would apply it a second time and bend
 *   the result. This is the single most common way this technique is got wrong.
 */
export const STYLES = /* css */ `
:host {
  display: block;
  position: relative;
  overflow: hidden;
}

:host([hidden]) { display: none; }

/*
  The photo's aspect ratio lives on the root, not the host, and that placement is
  deliberate.

  Left on the host it silently breaks the headline use case: an author writing
  "position: fixed; inset: 0" to make the photo a full-page background gets a
  host whose height is auto, and an aspect-ratio makes that height
  *determinate* — so the element stops stretching to fill the viewport and
  letterboxes instead.

  Down here it does the right thing in both cases. When the host has no given
  height, "height: 100%" resolves against an indefinite parent, falls back to
  auto, and the aspect ratio supplies the height. When the host *is* sized —
  stretched by insets, or given an explicit height — "height: 100%" is definite
  and the aspect ratio is ignored, exactly as it should be.
*/
[part='root'] {
  position: relative;
  width: 100%;
  height: 100%;
  aspect-ratio: var(--image-aware-aspect, auto);
}

[part='image'] {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: var(--image-aware-fit, contain);
  object-position: var(--image-aware-object-position, 50% 50%);
  user-select: none;
  -webkit-user-drag: none;
}

[part='surface'] {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  /* Keep nested 3D transforms in slotted content from compounding with ours. */
  transform-style: flat;
  /* Deliberately NOT will-change: transform. In Chrome that pins the raster
     scale at the layer's initial size, which makes transformed text blurrier,
     not sharper. */
}

[part='surface'][data-clip='true'] { overflow: hidden; }

/* An invalid quad renders nothing rather than something garbled. */
[part='surface'][data-ok='false'] { display: none; }

/*
  Flat mode. Below some width a projected surface is simply too small to touch —
  a 646px-wide design space landing on 200 screen px turns a 44px button into a
  13px one — so the element stops projecting and the content becomes an ordinary
  block flow under the photo.

  The element clears its own inline width/height/transform when flat, so nothing
  here needs !important. The host keeps a "data-flat" attribute while this is on,
  which is the hook page CSS uses to restyle slotted content: design-space
  lengths mean nothing once the projection is gone.
*/
:host([data-flow]) { overflow: visible; }

/*
  Something is in normal flow, so the element has real height now and a fixed
  aspect ratio would fight it. The ratio moves to the photo, which is itself a
  normal block at this point.
*/
:host([data-flow]) [part='root'] {
  height: auto;
  aspect-ratio: auto;
}

:host([data-flow]) [part='image'] {
  height: auto;
  aspect-ratio: var(--image-aware-aspect, auto);
}

/* Ordinary content, stacked after the photo. */
[part='surface'][data-placement='flow'],
[part='surface'][data-placement='flow'][data-clip='true'] {
  position: static;
  transform: none;
  overflow: visible;
}

/*
  Floating: still absolute, but positioned as a share of the element rather than
  by a transform, so it scales with the screen and stays upright.

  It stops clipping too, for the same reason a flow placement does: clip means
  "keep this content inside the object it was marked onto", and a floated surface
  is no longer on that object — it is a box the art direction chose. Clipping it
  there cuts off anything a card legitimately paints outside its own bounds: a
  drop shadow, a glow, a focus ring. Those are the first things an author reaches
  for once content is floating on open photograph rather than sitting on a laptop
  screen, and until now none of them could survive the float.

  Deliberately not made overridable per placement. A page that wants a floated
  box to clip can set overflow:hidden on its own slotted element, which it
  controls; nobody outside this shadow root can *remove* a clip we impose, so
  visible is the only default that leaves both options open.
*/
[part='surface'][data-placement='float'],
[part='surface'][data-placement='float'][data-clip='true'] {
  transform: none;
  overflow: visible;
}

/* Dropped for this variant. The content stays in the light DOM, unrendered. */
[part='surface'][data-placement='none'] { display: none; }
`;
