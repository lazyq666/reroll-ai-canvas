// Shared runtime for the brand loading animation of `ic-loading`.
// Every loader starts on the exact logo and follows the same 2 s cycle; all of
// them share one requestAnimationFrame loop and reuse traced frames per grid
// density. Loaders pause while hidden, off-screen or in a background tab, and
// hold the static mark under Reduced Motion.
import { LOADER_CYCLE_MS, LOADER_VIEWBOX, LOGO_PATH, VIEWBOX, loaderScene, tracePath } from '../brand-motion.js?v=asset-e0ba2ddc4250';

const FRAMES = Math.round(LOADER_CYCLE_MS / (1000 / 60));
// Grid cells across the logo, about one per 2.2 device pixels, in a few fixed
// steps so loaders of similar size share cached frames.
const DENSITIES = [28, 40, 56, 80, 112];
const frameCache = new Map();
const loaders = new Map();
let frameRequest = 0;
let reducedQuery = null;
let intersection = null;
let resize = null;

function densityFor(width) {
  const devicePixels = width * (globalThis.devicePixelRatio || 1) * (VIEWBOX / LOADER_VIEWBOX[2]);
  return DENSITIES.find(value => value >= devicePixels / 2.2) ?? DENSITIES.at(-1);
}

function framePath(density, index) {
  let frames = frameCache.get(density);
  if (!frames) {
    frames = new Array(FRAMES);
    frameCache.set(density, frames);
  }
  frames[index] ??= tracePath(loaderScene((index / FRAMES) * LOADER_CYCLE_MS), density);
  return frames[index];
}

function prefersReducedMotion(target) {
  return Boolean(reducedQuery?.matches)
    || document.documentElement.dataset.uiMotion === 'reduced'
    || Boolean(target.getRootNode?.().host?.closest?.('[data-ui-motion="reduced"]'));
}

function draw(loader, d) {
  if (loader.d === d) return;
  loader.d = d;
  loader.path.setAttribute('d', d);
}

function animating(loader) {
  return loader.visible && !loader.reduced;
}

function tick(now) {
  frameRequest = 0;
  let running = false;
  for (const loader of loaders.values()) {
    if (loader.reduced) draw(loader, LOGO_PATH);
    if (!animating(loader)) continue;
    loader.start ??= now;
    const elapsed = (now - loader.start) % LOADER_CYCLE_MS;
    draw(loader, framePath(loader.density, Math.floor((elapsed / LOADER_CYCLE_MS) * FRAMES) % FRAMES));
    running = true;
  }
  if (running) schedule();
}

function schedule() {
  if (frameRequest || document.hidden) return;
  for (const loader of loaders.values()) {
    if (animating(loader)) {
      frameRequest = requestAnimationFrame(tick);
      return;
    }
  }
}

function refreshMotionPreference() {
  for (const loader of loaders.values()) {
    loader.reduced = prefersReducedMotion(loader.target);
    if (loader.reduced) draw(loader, LOGO_PATH);
  }
  schedule();
}

function ensureObservers() {
  if (intersection) return;
  reducedQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  reducedQuery?.addEventListener?.('change', refreshMotionPreference);
  const motionObserver = new MutationObserver(refreshMotionPreference);
  motionObserver.observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-ui-motion'], subtree: true,
  });
  document.addEventListener('visibilitychange', schedule);
  intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const loader = loaders.get(entry.target);
      if (loader) loader.visible = entry.isIntersecting;
    }
    schedule();
  });
  resize = new ResizeObserver(entries => {
    for (const entry of entries) {
      const loader = loaders.get(entry.target);
      if (loader) loader.density = densityFor(entry.contentRect.width);
    }
  });
}

/**
 * Animate `path` (inside `target`, the element that sets the mark's size) as
 * the brand loader. Returns a function that stops and releases it.
 */
export function attachBrandLoader(target, path) {
  ensureObservers();
  const loader = {
    target,
    path,
    d: '',
    start: null,
    visible: true,
    reduced: prefersReducedMotion(target),
    density: densityFor(target.getBoundingClientRect().width || 40),
  };
  loaders.set(target, loader);
  draw(loader, LOGO_PATH);
  intersection.observe(target);
  resize.observe(target);
  schedule();
  return () => {
    loaders.delete(target);
    intersection.unobserve(target);
    resize.unobserve(target);
  };
}
