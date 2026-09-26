import {
  LOADER_BEATS,
  LOADER_CYCLE_MS,
  LOADER_VIEWBOX,
  LOGO_PATH,
  SPLASH_MS,
  VIEWBOX,
  loaderScene,
  splashScene,
  tracePath,
} from '/static/js/infinite-canvas-ui/brand-motion.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);
const span = (time, start, end) => clamp01((time - start) / (end - start));
const lerp = (from, to, amount) => from + (to - from) * amount;
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeOutQuint = t => 1 - (1 - t) ** 5;

// Lockup proportions measured from wordmark.svg at its 112px sidebar width:
// mark 30.07, gap 8.14, word 73.68 × 22.69.
const WORD_WIDTH = 73.68 / 30.07;
const WORD_HEIGHT = 22.69 / 30.07;
const WORD_GAP = 8.14 / 30.07;
const LOCKUP_WIDTH = 1 + WORD_GAP + WORD_WIDTH;
const LOCKUP_SCALE = 0.58;

// Startup choreography in milliseconds. The mark itself runs 0 – SPLASH_MS.
const T = {
  lockStart: 1450,
  lockEnd: 2050,
  lettersStart: 1560,
  letterStagger: 55,
  letterMs: 440,
  wait: 2450,
  dock: 650,
  fadeLead: 480,
  fade: 450,
  replayHold: 1400,
};
const FAST_BOOT_MS = 1500;
const SLOW_BOOT_MS = 5600;
const LOADER_FRAMES = Math.round(LOADER_CYCLE_MS / (1000 / 60));

const state = {
  playing: true,
  speed: 1,
  slowBoot: false,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  clock: 0,
  loaderClock: 0,
  loaderOverride: null,
  timeline: null,
  geometry: null,
};

const stage = $('stage');
const overlay = $('entryOverlay');
const lockup = $('entryLockup');
const markHost = $('entryMark');
const wordClip = $('entryWordClip');
const word = $('entryWord');
const status = $('entryStatus');
const grid = $('entryGrid');
const mockApp = $('mockApp');
const scrubber = $('scrubber');
const timeReadout = $('timeReadout');
const playButton = $('playButton');

function createMark(viewBox = [0, 0, VIEWBOX, VIEWBOX]) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox.join(' '));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', LOGO_PATH);
  svg.append(path);
  return { svg, path, d: LOGO_PATH };
}

function setPath(mark, d) {
  if (mark.d === d) return;
  mark.d = d;
  mark.path.setAttribute('d', d);
}

// Brand SVGs paint their counters white. Rebuild them as a luminance mask over
// `currentColor` so the counters are truly transparent in either theme. With
// `glyphs`, each dark shape is grouped with the counters inside it so letters
// can move on their own.
let maskSerial = 0;
async function inlineBrandSvg(url, { glyphs = false } = {}) {
  const text = await (await fetch(url)).text();
  const source = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  const [, , width, height] = source.getAttribute('viewBox').split(/\s+/).map(Number);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('overflow', 'visible');
  const mask = document.createElementNS(SVG_NS, 'mask');
  maskSerial += 1;
  mask.id = `brand-mask-${maskSerial}`;
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', String(-width * 0.2));
  mask.setAttribute('y', String(-height));
  mask.setAttribute('width', String(width * 1.4));
  mask.setAttribute('height', String(height * 3));

  // Measure shapes in a throwaway rendered SVG to group glyphs.
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

  const groups = [];
  if (glyphs) {
    const inside = (inner, outer) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1
      && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;
    const darks = shapes.filter(shape => !shape.light).sort((a, b) => a.box.x - b.box.x);
    for (const dark of darks) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.append(dark.copy);
      for (const hole of shapes.filter(shape => shape.light && inside(shape.box, dark.box))) group.append(hole.copy);
      mask.append(group);
      groups.push({ node: group, cx: dark.box.x + dark.box.width / 2, base: height, box: dark.box });
    }
  } else {
    for (const shape of shapes) mask.append(shape.copy);
  }

  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.append(mask);
  const fill = document.createElementNS(SVG_NS, 'rect');
  fill.setAttribute('x', String(-width * 0.2));
  fill.setAttribute('y', String(-height));
  fill.setAttribute('width', String(width * 1.4));
  fill.setAttribute('height', String(height * 3));
  fill.setAttribute('fill', 'currentColor');
  fill.setAttribute('mask', `url(#${mask.id})`);
  svg.append(defs, fill);
  return { svg, glyphs: groups };
}

// Grid cells across the 355-unit logo: about one cell per 2.2 device pixels,
// capped so a large startup mark stays near 2 ms per frame.
function cellsFor(cssPixels) {
  return Math.max(28, Math.min(120, Math.round((cssPixels * (window.devicePixelRatio || 1)) / 2.2)));
}

const loaderCache = new Map();
function loaderPath(time, cells, exact = false) {
  if (exact) return tracePath(loaderScene(time), cells);
  const cycle = ((time % LOADER_CYCLE_MS) + LOADER_CYCLE_MS) % LOADER_CYCLE_MS;
  const frame = Math.floor((cycle / LOADER_CYCLE_MS) * LOADER_FRAMES);
  const key = `${cells}:${frame}`;
  let d = loaderCache.get(key);
  if (!d) {
    d = tracePath(loaderScene((frame / LOADER_FRAMES) * LOADER_CYCLE_MS), cells);
    loaderCache.set(key, d);
  }
  return d;
}

// ---------------------------------------------------------------- startup

const entryMark = createMark();
markHost.append(entryMark.svg);

// Smallest loader beat (a moment the mark is exactly the logo) at or after `ms`.
function nextBeat(ms) {
  const cycles = Math.floor(ms / LOADER_CYCLE_MS);
  const rest = ms - cycles * LOADER_CYCLE_MS;
  return cycles * LOADER_CYCLE_MS + LOADER_BEATS.find(beat => beat >= rest);
}

function buildTimeline() {
  const bootMs = state.slowBoot ? SLOW_BOOT_MS : FAST_BOOT_MS;
  if (state.reduced) {
    const fadeStart = Math.max(bootMs, 900);
    return { bootMs, loading: 0, loadStart: fadeStart, dockStart: fadeStart, fadeStart, end: fadeStart + 300 };
  }
  // A slow boot keeps the lockup on screen and runs whole loader cycles, so
  // the mark always leaves from an exact logo frame.
  const loading = bootMs > T.wait ? nextBeat(bootMs - T.wait) : 0;
  const dockStart = T.wait + loading;
  const fadeStart = dockStart + T.fadeLead;
  return { bootMs, loading, loadStart: T.wait, dockStart, fadeStart, end: fadeStart + T.fade };
}

function measure() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const size = Math.round(Math.min(width * 0.24, height * 0.34));
  const base = size * LOCKUP_WIDTH;
  markHost.style.width = `${size}px`;
  markHost.style.height = `${size}px`;
  wordClip.style.width = `${size * WORD_WIDTH}px`;
  wordClip.style.height = `${size * WORD_HEIGHT}px`;
  wordClip.style.marginLeft = `${size * WORD_GAP}px`;
  status.style.left = `${size * (1 + WORD_GAP)}px`;
  status.style.bottom = `${-18 / LOCKUP_SCALE}px`;
  status.style.fontSize = `${11 / LOCKUP_SCALE}px`;

  // Measure the dock target in its settled, untransformed layout.
  const settleTransform = mockApp.style.transform;
  mockApp.style.transform = 'none';
  const stageRect = stage.getBoundingClientRect();
  const targetRect = $('dockTarget').getBoundingClientRect();
  mockApp.style.transform = settleTransform;
  const hasTarget = targetRect.width > 0 && getComputedStyle($('dockTarget')).visibility !== 'hidden';
  const docked = LOCKUP_SCALE * 0.62;
  const dockScale = hasTarget ? targetRect.width / base : docked;
  state.geometry = {
    cells: cellsFor(size),
    mark: { x: width / 2 - size / 2, y: height / 2 - size / 2, k: 1 },
    lockup: { x: width / 2 - (base * LOCKUP_SCALE) / 2, y: height / 2 - (size * LOCKUP_SCALE) / 2, k: LOCKUP_SCALE },
    dock: hasTarget
      ? {
        x: targetRect.left - stageRect.left - stage.clientLeft,
        y: targetRect.top - stageRect.top - stage.clientTop + targetRect.height / 2 - (size * dockScale) / 2,
        k: dockScale,
      }
      : { x: width / 2 - (base * docked) / 2, y: height / 2 - (size * docked) / 2, k: docked },
  };
}

function mixPlacement(from, to, amount) {
  return { x: lerp(from.x, to.x, amount), y: lerp(from.y, to.y, amount), k: lerp(from.k, to.k, amount) };
}

// Letters surface left to right: a short rise and fade, no overshoot.
let letterGlyphs = [];
function renderLetters(time) {
  letterGlyphs.forEach((glyph, index) => {
    const start = T.lettersStart + index * T.letterStagger;
    const q = easeOutCubic(span(time, start, start + T.letterMs));
    const transform = q >= 1 ? '' : `translate(0 ${((1 - q) * glyph.rise).toFixed(2)})`;
    const opacity = q >= 1 ? '' : q.toFixed(3);
    if (glyph.transform !== transform) {
      glyph.transform = transform;
      if (transform) glyph.node.setAttribute('transform', transform);
      else glyph.node.removeAttribute('transform');
    }
    if (glyph.opacity !== opacity) {
      glyph.opacity = opacity;
      if (opacity) glyph.node.setAttribute('opacity', opacity);
      else glyph.node.removeAttribute('opacity');
    }
  });
}

function renderStage(time) {
  const timeline = state.timeline;
  const geometry = state.geometry;
  stage.classList.toggle('is-reduced', state.reduced);
  const fade = easeOutCubic(span(time, timeline.fadeStart, timeline.end));
  overlay.style.opacity = String(1 - fade);
  overlay.style.visibility = fade >= 1 ? 'hidden' : 'visible';
  mockApp.style.transform = `scale(${1.012 - 0.012 * easeOutQuint(span(time, timeline.fadeStart - 120, timeline.end))})`;
  if (state.reduced) return;

  const loading = timeline.loading > 0 && time >= timeline.loadStart && time < timeline.dockStart;
  if (time < SPLASH_MS) setPath(entryMark, tracePath(splashScene(time), geometry.cells));
  else if (loading) setPath(entryMark, loaderPath(time - timeline.loadStart, geometry.cells));
  else setPath(entryMark, LOGO_PATH);

  const toLockup = easeInOutCubic(span(time, T.lockStart, T.lockEnd));
  const toDock = easeInOutCubic(span(time, timeline.dockStart, timeline.dockStart + T.dock));
  const placement = mixPlacement(mixPlacement(geometry.mark, geometry.lockup, toLockup), geometry.dock, toDock);
  lockup.style.transform = `translate(${placement.x.toFixed(2)}px, ${placement.y.toFixed(2)}px) scale(${placement.k.toFixed(4)})`;

  renderLetters(time);

  const statusIn = loading ? easeOutCubic(span(time, timeline.loadStart, timeline.loadStart + 320)) : 0;
  const statusOut = 1 - span(time, timeline.dockStart - 240, timeline.dockStart);
  status.style.opacity = String(statusIn * statusOut);
  grid.style.opacity = String(0.8 * easeOutCubic(span(time, T.lockStart, T.wait)) * (1 - toDock * 0.4));
}

function renderTimelineTrack() {
  const timeline = state.timeline;
  const track = $('timelineTrack');
  const total = timeline.end;
  const segments = state.reduced
    ? [['静态组合标', 0, timeline.fadeStart], ['淡出', timeline.fadeStart, timeline.end]]
    : [
      ['汇聚', 0, 520],
      ['成环', 520, 700],
      ['合一', 700, 860],
      ['展开', 860, SPLASH_MS],
      ['文字', SPLASH_MS, T.wait],
      ...(timeline.loading ? [[`加载 ${(timeline.loading / 1000).toFixed(1)} s`, T.wait, timeline.dockStart, true]] : []),
      ['收入侧栏', timeline.dockStart, timeline.fadeStart],
      ['淡出', timeline.fadeStart, timeline.end],
    ];
  track.replaceChildren(...segments.map(([label, start, end, isLoading]) => {
    const item = document.createElement('span');
    item.textContent = label;
    item.style.left = `${(start / total) * 100}%`;
    item.style.width = `calc(${((end - start) / total) * 100}% - 2px)`;
    if (isLoading) item.className = 'is-loading';
    return item;
  }));
  scrubber.max = String(Math.round(total));
  document.querySelector('.proto-title span').textContent = state.slowBoot
    ? `启动 ${(timeline.end / 1000).toFixed(2)} 秒（慢启动 ${(timeline.bootMs / 1000).toFixed(1)} 秒）· 加载循环 ${LOADER_CYCLE_MS / 1000} 秒 · 纯矢量，无视频`
    : `启动 ${(timeline.end / 1000).toFixed(2)} 秒 · 加载循环 ${LOADER_CYCLE_MS / 1000} 秒 · 纯矢量，无视频`;
}

function resetTimeline({ restart = true } = {}) {
  state.timeline = buildTimeline();
  if (restart) state.clock = 0;
  renderTimelineTrack();
}

// ---------------------------------------------------------------- loaders

const loaders = [...document.querySelectorAll('.brand-loader')].map(host => {
  const size = Number(host.dataset.size);
  host.style.width = `${size}px`;
  host.style.height = `${size}px`;
  const mark = createMark(LOADER_VIEWBOX);
  host.append(mark.svg);
  return { host, mark, cells: cellsFor(size * (VIEWBOX / LOADER_VIEWBOX[2])), hero: size >= 120 };
});

const phaseChips = [...document.querySelectorAll('[data-phase]')];

function renderLoaders() {
  document.body.classList.toggle('is-reduced-motion', state.reduced);
  const active = state.reduced ? '' : loaderScene(state.loaderOverride ?? state.loaderClock).phase;
  for (const chip of phaseChips) chip.classList.toggle('is-active', chip.dataset.phase === active);
  for (const loader of loaders) {
    if (state.reduced) {
      setPath(loader.mark, LOGO_PATH);
    } else if (loader.hero && state.loaderOverride !== null) {
      setPath(loader.mark, loaderPath(state.loaderOverride, loader.cells, true));
    } else {
      setPath(loader.mark, loaderPath(state.loaderClock, loader.cells));
    }
  }
}

// ---------------------------------------------------------------- clock

let lastFrame = performance.now();
function tick(now) {
  const delta = Math.min(64, now - lastFrame) * state.speed;
  lastFrame = now;
  if (state.playing) {
    state.clock += delta;
    state.loaderClock += delta;
    if (state.clock > state.timeline.end + T.replayHold) state.clock = 0;
  }
  const shown = Math.min(state.clock, state.timeline.end);
  renderStage(shown);
  renderLoaders();
  scrubber.value = String(Math.round(shown));
  timeReadout.textContent = `${Math.round(shown)} ms`;
  requestAnimationFrame(tick);
}

function setPlaying(playing) {
  state.playing = playing;
  playButton.textContent = playing ? '暂停' : '播放';
  playButton.setAttribute('aria-pressed', String(playing));
  if (playing) {
    state.loaderOverride = null;
    $('loaderReadout').textContent = '跟随播放';
  }
}

$('replayButton').addEventListener('click', () => {
  resetTimeline();
  setPlaying(true);
});
playButton.addEventListener('click', () => setPlaying(!state.playing));
scrubber.addEventListener('input', () => {
  setPlaying(false);
  state.clock = Number(scrubber.value);
});
$('loaderScrubber').addEventListener('input', event => {
  state.loaderOverride = Number(event.target.value);
  $('loaderReadout').textContent = `${state.loaderOverride} ms`;
});
for (const button of document.querySelectorAll('[data-speed]')) {
  button.addEventListener('click', () => {
    state.speed = Number(button.dataset.speed);
    for (const other of document.querySelectorAll('[data-speed]')) other.setAttribute('aria-pressed', String(other === button));
  });
}
$('slowBootToggle').addEventListener('change', event => {
  state.slowBoot = event.target.checked;
  resetTimeline();
  setPlaying(true);
});
const reducedToggle = $('reducedToggle');
reducedToggle.checked = state.reduced;
reducedToggle.addEventListener('change', event => {
  state.reduced = event.target.checked;
  resetTimeline();
  setPlaying(true);
});
$('themeButton').addEventListener('click', event => {
  const dark = document.documentElement.dataset.uiTheme !== 'dark';
  document.documentElement.dataset.uiTheme = dark ? 'dark' : 'light';
  event.currentTarget.textContent = dark ? '浅色' : '深色';
  event.currentTarget.setAttribute('aria-pressed', String(dark));
});

// ---------------------------------------------------------------- boot

const [wordArt, wordmarkArt, reducedArt] = await Promise.all([
  inlineBrandSvg('/static/images/brand/word.svg', { glyphs: true }),
  inlineBrandSvg('/static/images/brand/wordmark.svg'),
  inlineBrandSvg('/static/images/brand/wordmark.svg'),
]);
word.append(wordArt.svg);
letterGlyphs = wordArt.glyphs.map(glyph => ({ ...glyph, rise: 34, transform: null, opacity: null }));
$('dockTarget').append(wordmarkArt.svg);
$('entryReduced').append(reducedArt.svg);

measure();
new ResizeObserver(measure).observe(stage);
resetTimeline();
requestAnimationFrame(now => {
  lastFrame = now;
  tick(now);
});
