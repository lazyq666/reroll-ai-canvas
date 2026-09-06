import { frameBreathingRing, paintFrame } from '../../vendor/libraries-motion/999866f/orbs.js';

// One drawing contract for every generation status: the 20px breathing ring.
export function paintGenerationOrb(canvas, seconds, dark) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, 20, 20);
  paintFrame(ctx, frameBreathingRing(seconds), dark);
  return true;
}

// Pending nodes use their existing Halftone clock. Standalone runtime badges
// share this small clock, rather than allocating a loop per node.
const badges = new Map();
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let motionReduced = motion.matches;
function syncMotion() { motionReduced = motion.matches; sync(); }
let intersection, environment, frame = 0, last = 0;
function stateFor(entry) {
  if (motionReduced || entry.host.closest('[data-ui-motion="reduced"]')) return 'static';
  return document.hidden || !entry.visible ? 'paused' : 'running';
}
function draw(entry, seconds) {
  paintGenerationOrb(entry.canvas, seconds, document.documentElement.dataset.uiTheme === 'dark');
}
function tick(now) {
  frame = 0;
  const running = [...badges.values()].filter(entry => stateFor(entry) === 'running');
  if (!running.length) return;
  if (now - last >= 1000 / 24) {
    last = now;
    for (const entry of running) draw(entry, now / 1000);
  }
  frame = requestAnimationFrame(tick);
}
function sync() {
  let running = false;
  for (const entry of badges.values()) {
    const state = stateFor(entry);
    entry.canvas.dataset.motionState = state;
    if (state === 'static') draw(entry, 0.6);
    else if (state === 'running') { draw(entry, performance.now() / 1000); running = true; }
  }
  if (running && !frame) frame = requestAnimationFrame(tick);
  if (!running && frame) { cancelAnimationFrame(frame); frame = 0; }
}
export function connectGenerationOrb(host, canvas) {
  if (!canvas || !paintGenerationOrb(canvas, 0.6, document.documentElement.dataset.uiTheme === 'dark')) return;
  if (!badges.size) {
    intersection = new IntersectionObserver(entries => {
      for (const item of entries) { const entry = badges.get(item.target); if (entry) entry.visible = item.isIntersecting; }
      sync();
    });
    environment = new MutationObserver(sync);
    environment.observe(document.documentElement, {attributes:true, attributeFilter:['data-ui-theme','data-ui-motion']});
    motionReduced = motion.matches;
    motion.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', sync);
  }
  badges.set(host, {host,canvas,visible:false});
  intersection.observe(host);
  sync();
  return true;
}
export function disconnectGenerationOrb(host) {
  if (!badges.delete(host)) return;
  intersection.unobserve(host);
  if (!badges.size) {
    intersection.disconnect(); environment.disconnect();
    motion.removeEventListener('change', syncMotion);
    document.removeEventListener('visibilitychange', sync);
  }
  sync();
}
