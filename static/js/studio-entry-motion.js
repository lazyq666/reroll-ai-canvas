import {
  LOADER_BEATS,
  LOADER_CYCLE_MS,
  LOGO_PATH,
  SPLASH_MS,
  loaderScene,
  splashScene,
  tracePath,
} from '/static/js/infinite-canvas-ui/brand-motion.js?v=asset-e0ba2ddc4250';

const STORAGE_KEY = 'studio_brand_entry_seen';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Lockup proportions measured from wordmark.svg at the sidebar's 112px width:
// mark 30.07, gap 8.14, word 73.68 × 22.69.
const WORD_WIDTH = 73.68 / 30.07;
const WORD_HEIGHT = 22.69 / 30.07;
const WORD_GAP = 8.14 / 30.07;
const LOCKUP_WIDTH = 1 + WORD_GAP + WORD_WIDTH;
const LOCKUP_SCALE = 0.58;
const NARROW_DOCK_SCALE = LOCKUP_SCALE * 0.62;
// Choreography in milliseconds; the mark itself runs 0 – SPLASH_MS. Without a
// slow start the whole entry ends at FADE_START + FADE_MS = 3380 ms.
const LOCK_START = 1450;
const LOCK_END = 2050;
const LETTERS_START = 1560;
const LETTER_STAGGER = 55;
const LETTER_MS = 440;
const LETTER_RISE = 34;
const WAIT_AT = 2450;
const DOCK_MS = 650;
const FADE_LEAD = 480;
const FADE_MS = 450;
const STATUS_MS = 320;
const REDUCED_HOLD_MS = 220;
const MAX_FRAME_MS = 64;

const root = document.getElementById('studioEntryMotion');
const markPath = document.getElementById('studioEntryMarkPath');
const lockup = root?.querySelector('.studio-entry-lockup');
const markFrame = root?.querySelector('.studio-entry-mark-frame');
const wordFrame = root?.querySelector('.studio-entry-word-frame');
const status = root?.querySelector('.studio-entry-status');
const grid = root?.querySelector('.studio-entry-grid');

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);
const span = (time, start, end) => clamp01((time - start) / (end - start));
const lerp = (from, to, amount) => from + (to - from) * amount;
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const easeOutCubic = t => 1 - (1 - t) ** 3;

function alreadySeen() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
}

function isReloadNavigation() {
  const navigation = performance.getEntriesByType?.('navigation')?.[0];
  return navigation?.type === 'reload' || performance.navigation?.type === 1;
}

function rememberSeen() {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
}

function routeIsReady() {
  return !document.documentElement.classList.contains('studio-route-booting');
}

function afterRouteReady(callback) {
  if (routeIsReady()) {
    callback();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!routeIsReady()) return;
    observer.disconnect();
    callback();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

let completed = false;

// Hand over to the App Shell: remember the entry, fade the layer, remove it.
function finish() {
  if (completed) return;
  completed = true;
  rememberSeen();
  root.classList.remove('is-loading');
  root.dataset.entryState = 'finished';
  window.dispatchEvent(new CustomEvent('studio-entry-motion-complete'));
  setTimeout(() => root.remove(), FADE_MS + 60);
}

// Smallest loader beat — a frame that is exactly the logo — at or after `ms`.
function nextBeat(ms) {
  const cycles = Math.floor(ms / LOADER_CYCLE_MS);
  const rest = ms - cycles * LOADER_CYCLE_MS;
  return cycles * LOADER_CYCLE_MS + LOADER_BEATS.find(beat => beat >= rest);
}

// Grid cells across the 355-unit logo: about one per 2.2 device pixels, capped
// so the large startup mark stays near 2 ms per frame.
function densityFor(cssPixels) {
  return Math.max(28, Math.min(120, Math.round((cssPixels * (window.devicePixelRatio || 1)) / 2.2)));
}

// word.svg paints its counters white. Rebuild it as a luminance mask over
// `currentColor`, grouping each letter with its counters so letters can
// surface one by one; the <img> stays as the fallback when this fails.
async function inlineWord(image) {
  const response = await fetch(image.currentSrc || image.src);
  if (!response.ok) throw new Error('word.svg unavailable');
  const source = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement;
  const [, , width, height] = source.getAttribute('viewBox').split(/\s+/).map(Number);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'studio-entry-word');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const probe = document.createElementNS(SVG_NS, 'svg');
  probe.setAttribute('style', 'position:absolute;visibility:hidden;width:0;height:0');
  document.body.append(probe);
  const shapes = [...source.querySelectorAll('path, circle, rect, ellipse')]
    .filter(shape => (shape.getAttribute('fill') || '#000') !== 'none')
    .map(shape => {
      const copy = document.importNode(shape, true);
      const hex = (shape.getAttribute('fill') || '#000').replace('#', '');
      const light = hex.length === 6 && parseInt(hex.slice(0, 2), 16) > 128;
      copy.setAttribute('fill', light ? '#000' : '#fff');
      probe.append(copy);
      return { copy, light, box: copy.getBBox() };
    });
  probe.remove();
  const inside = (inner, outer) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1
    && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;
  const mask = document.createElementNS(SVG_NS, 'mask');
  mask.id = 'studioEntryWordMask';
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  const glyphs = shapes.filter(shape => !shape.light).sort((a, b) => a.box.x - b.box.x).map(dark => {
    const group = document.createElementNS(SVG_NS, 'g');
    group.append(dark.copy);
    shapes.filter(shape => shape.light && inside(shape.box, dark.box)).forEach(hole => group.append(hole.copy));
    mask.append(group);
    return group;
  });
  const area = { x: -width * 0.2, y: -height, width: width * 1.4, height: height * 3 };
  Object.entries(area).forEach(([name, value]) => mask.setAttribute(name, String(value)));
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.append(mask);
  const fill = document.createElementNS(SVG_NS, 'rect');
  Object.entries(area).forEach(([name, value]) => fill.setAttribute(name, String(value)));
  fill.setAttribute('fill', 'currentColor');
  fill.setAttribute('mask', `url(#${mask.id})`);
  svg.append(defs, fill);
  return { svg, glyphs, rise: LETTER_RISE };
}

function run() {
  root.dataset.entryRuntime = 'ready';
  if (isReloadNavigation() || alreadySeen()) {
    root.remove();
    return;
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.dataset.entryState = 'reduced';
    afterRouteReady(() => setTimeout(finish, REDUCED_HOLD_MS));
    return;
  }

  const wordImage = wordFrame.querySelector('img');
  let letters = [{ node: wordImage, rise: 0, html: true }];
  inlineWord(wordImage).then(result => {
    wordImage.replaceWith(result.svg);
    letters = result.glyphs.map(node => ({ node, rise: result.rise }));
  }).catch(() => {});

  let geometry = measureStart();
  let dockRequested = false;
  let clock = 0;
  let last = null;
  let loadStart = null;
  let dockStart = null;
  let drawn = '';

  function measureStart() {
    const width = innerWidth;
    const height = innerHeight;
    const size = Math.round(Math.max(150, Math.min(286, width * 0.23, height * 0.34)));
    const base = size * LOCKUP_WIDTH;
    markFrame.style.width = `${size}px`;
    markFrame.style.height = `${size}px`;
    wordFrame.style.width = `${size * WORD_WIDTH}px`;
    wordFrame.style.height = `${size * WORD_HEIGHT}px`;
    wordFrame.style.marginLeft = `${size * WORD_GAP}px`;
    status.style.left = `${size * (1 + WORD_GAP)}px`;
    status.style.top = `${size * (0.5 + WORD_HEIGHT / 2) + 14 / LOCKUP_SCALE}px`;
    status.style.fontSize = `${11 / LOCKUP_SCALE}px`;
    return {
      size,
      base,
      density: densityFor(size),
      mark: { x: width / 2 - size / 2, y: height / 2 - size / 2, k: 1 },
      lockup: { x: width / 2 - (base * LOCKUP_SCALE) / 2, y: height / 2 - (size * LOCKUP_SCALE) / 2, k: LOCKUP_SCALE },
      dock: { x: width / 2 - (base * NARROW_DOCK_SCALE) / 2, y: height / 2 - (size * NARROW_DOCK_SCALE) / 2, k: NARROW_DOCK_SCALE },
    };
  }

  // The App Shell expands the sidebar on this event, well before docking.
  function requestDock() {
    dockRequested = true;
    if (matchMedia('(min-width: 721px)').matches) window.dispatchEvent(new CustomEvent('studio-entry-motion-dock'));
  }

  // Measure the real sidebar wordmark as docking starts, so the lockup lands
  // exactly on it; narrow windows have no sidebar logo and settle centred.
  function measureDock() {
    if (!matchMedia('(min-width: 721px)').matches) return;
    const rect = document.querySelector('.sidebar-logo-image.sidebar-logo-wordmark')?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const k = rect.width / geometry.base;
    geometry.dock = { x: rect.left, y: rect.top + rect.height / 2 - (geometry.size * k) / 2, k };
  }

  function placement(time) {
    const toLockup = easeInOutCubic(span(time, LOCK_START, LOCK_END));
    const toDock = dockStart === null ? 0 : easeInOutCubic(span(time, dockStart, dockStart + DOCK_MS));
    const mix = (from, to, amount) => ({ x: lerp(from.x, to.x, amount), y: lerp(from.y, to.y, amount), k: lerp(from.k, to.k, amount) });
    return { ...mix(mix(geometry.mark, geometry.lockup, toLockup), geometry.dock, toDock), toDock };
  }

  function drawMark(d) {
    if (d === drawn) return;
    drawn = d;
    markPath.setAttribute('d', d);
  }

  function renderLetters(time) {
    letters.forEach((letter, index) => {
      const start = LETTERS_START + index * LETTER_STAGGER;
      const q = easeOutCubic(span(time, start, start + LETTER_MS));
      if (letter.html) {
        letter.node.style.opacity = String(q);
        letter.node.style.transform = `translateY(${((1 - q) * 12).toFixed(2)}%)`;
        return;
      }
      if (q >= 1) {
        letter.node.removeAttribute('transform');
        letter.node.removeAttribute('opacity');
      } else {
        letter.node.setAttribute('transform', `translate(0 ${((1 - q) * letter.rise).toFixed(2)})`);
        letter.node.setAttribute('opacity', q.toFixed(3));
      }
    });
  }

  function setState(state) {
    if (root.dataset.entryState !== state) root.dataset.entryState = state;
  }

  function frame(now) {
    clock += last === null ? 0 : Math.min(MAX_FRAME_MS, now - last);
    last = now;
    const time = clock;

    if (time >= LOCK_START && !dockRequested) requestDock();
    if (time >= WAIT_AT && dockStart === null) {
      // A slow start keeps the lockup and runs the loader beside the word;
      // docking waits for the next exact-logo beat after the route is ready.
      if (routeIsReady()) {
        dockStart = loadStart === null ? WAIT_AT : loadStart + nextBeat(time - loadStart);
      } else if (loadStart === null) {
        loadStart = WAIT_AT;
        root.classList.add('is-loading');
      }
    }
    if (dockStart !== null && time >= dockStart && !geometry.docking) {
      geometry.docking = true;
      measureDock();
    }
    const loading = loadStart !== null && (dockStart === null || time < dockStart);
    if (time < SPLASH_MS) drawMark(tracePath(splashScene(time), geometry.density));
    else if (loading) drawMark(tracePath(loaderScene(time - loadStart), densityFor(geometry.size * LOCKUP_SCALE)));
    else drawMark(LOGO_PATH);

    const place = placement(time);
    lockup.style.transform = `translate(${place.x.toFixed(2)}px, ${place.y.toFixed(2)}px) scale(${place.k.toFixed(4)})`;
    renderLetters(time);
    const statusIn = loadStart === null ? 0 : easeOutCubic(span(time, loadStart, loadStart + STATUS_MS));
    const statusOut = dockStart === null ? 1 : 1 - span(time, dockStart - 240, dockStart);
    status.style.opacity = String(statusIn * statusOut);
    grid.style.opacity = String(0.72 * easeOutCubic(span(time, LOCK_START, WAIT_AT)) * (1 - place.toDock * 0.4));

    // The layer fades over the last part of the dock, keeping its geometry.
    if (dockStart !== null && time >= dockStart + FADE_LEAD) finish();
    else setState(dockStart !== null && time >= dockStart ? 'docked' : time >= LOCK_START ? 'wordmark' : 'mark');
    if (!completed || time < dockStart + DOCK_MS) requestAnimationFrame(frame);
  }

  addEventListener('resize', () => {
    if (clock < LOCK_START) geometry = measureStart();
  });
  drawMark(tracePath(splashScene(0), geometry.density));
  requestAnimationFrame(frame);
}

if (root && markPath && lockup) run();
