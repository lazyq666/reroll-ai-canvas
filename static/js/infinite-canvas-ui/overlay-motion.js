export const ANCHORED_OVERLAY_MOTION_STYLES = `
  [part~="surface"] {
    --ic-overlay-motion-x: 0;
    --ic-overlay-motion-y: 0;
    --ic-overlay-motion-scale: .96;
    opacity: 1;
    transform: none;
    transform-origin: center;
    transition:
      opacity var(--ui-motion-duration-normal) var(--ui-motion-ease-fluid),
      transform var(--ui-motion-duration-normal) var(--ui-motion-ease-fluid);
  }
  [part~="surface"][data-motion-side="bottom"] { --ic-overlay-motion-y: calc(var(--ui-space-1) * -1); transform-origin: center top; }
  [part~="surface"][data-motion-side="top"] { --ic-overlay-motion-y: var(--ui-space-1); transform-origin: center bottom; }
  [part~="surface"][data-motion-side="right"] { --ic-overlay-motion-x: calc(var(--ui-space-1) * -1); transform-origin: left center; }
  [part~="surface"][data-motion-side="left"] { --ic-overlay-motion-x: var(--ui-space-1); transform-origin: right center; }
  :host([data-motion-state="entering"]) [part~="surface"],
  :host([data-motion-state="exiting"]) [part~="surface"] {
    opacity: 0;
    transform: translate3d(var(--ic-overlay-motion-x), var(--ic-overlay-motion-y), 0) scale(var(--ic-overlay-motion-scale));
    will-change: opacity, transform;
  }
  :host([data-motion-state="exiting"]) [part~="surface"] {
    pointer-events: none;
    transition-duration: var(--ui-motion-duration-fast);
    transition-timing-function: var(--ui-motion-ease-press);
  }
  :host([data-motion-state="closed"]) [part~="surface"] { display: none; }
  :host-context(html[data-ui-motion="reduced"]) [part~="surface"] {
    --ic-overlay-motion-x: 0;
    --ic-overlay-motion-y: 0;
    --ic-overlay-motion-scale: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    [part~="surface"] {
      --ic-overlay-motion-x: 0;
      --ic-overlay-motion-y: 0;
      --ic-overlay-motion-scale: 1;
    }
  }
`;

export function nextOverlayPaint() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

export async function waitForOverlayMotion(surface) {
  await nextOverlayPaint();
  await nextOverlayPaint();
  const animations = surface?.getAnimations?.() || [];
  await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
}

export function setOverlayInteraction(surface, interactive) {
  if (!surface) return;
  surface.toggleAttribute('inert', !interactive);
  if (interactive) surface.removeAttribute('aria-hidden');
  else surface.setAttribute('aria-hidden', 'true');
}
