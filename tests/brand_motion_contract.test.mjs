import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOADER_BEATS,
  LOADER_CYCLE_MS,
  LOADER_PHASES,
  LOADER_VIEWBOX,
  LOGO_PATH,
  SPLASH_MS,
  loaderScene,
  sceneDistance,
  splashScene,
  tracePath,
} from '../static/js/infinite-canvas-ui/brand-motion.js';

const LOGO_SVG = readFileSync(new URL('../static/images/brand/logo.svg', import.meta.url), 'utf8');

// Independent reference: flatten logo.svg's outline and test its two circles
// analytically, so "exact logo" is checked against the source asset itself.
function logoReference() {
  const d = LOGO_SVG.match(/<path d="([^"]+)"/)[1];
  const circles = [...LOGO_SVG.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)].map(match => match.slice(1).map(Number));
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g);
  const polygon = [];
  let x = 0;
  let y = 0;
  let index = 0;
  const number = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') { x = number(); y = number(); polygon.push([x, y]); }
    else if (command === 'H') { x = number(); polygon.push([x, y]); }
    else if (command === 'V') { y = number(); polygon.push([x, y]); }
    else if (command === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [number(), number(), number(), number(), number(), number()];
      for (let step = 1; step <= 48; step += 1) {
        const t = step / 48;
        const u = 1 - t;
        polygon.push([
          u ** 3 * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
          u ** 3 * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3,
        ]);
      }
      x = x3;
      y = y3;
    } else if (command !== 'Z') {
      throw new Error(`unsupported logo command ${command}`);
    }
  }
  return (px, py) => {
    if (circles.some(([cx, cy, r]) => (px - cx) ** 2 + (py - cy) ** 2 < r * r)) return true;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

function mismatchesWithLogo(scene) {
  const insideLogo = logoReference();
  let mismatches = 0;
  for (let y = -20; y <= 375; y += 2.5) {
    for (let x = -20; x <= 375; x += 2.5) {
      const distance = sceneDistance(x, y, scene);
      // Ignore the anti-aliasing band where both models legitimately differ.
      if (Math.abs(distance) < 1.5) continue;
      if ((distance < 0) !== insideLogo(x, y)) mismatches += 1;
    }
  }
  return mismatches;
}

const contourCount = scene => (tracePath(scene, 110).match(/M/g) || []).length;

test('startup and every loader cycle rest on the exact logo.svg geometry', () => {
  assert.equal(mismatchesWithLogo(splashScene(SPLASH_MS)), 0);
  assert.equal(mismatchesWithLogo(loaderScene(0)), 0);
  assert.equal(mismatchesWithLogo(loaderScene(LOADER_CYCLE_MS - 0.001)), 0);
  assert.match(LOGO_PATH, /^M3 71C3 33 34 2 72 2H106/);
  assert.ok(LOGO_PATH.includes(LOGO_SVG.match(/<path d="([^"]+)"/)[1]));
});

test('both motions fit in four seconds and the loader only stops on a logo beat', () => {
  assert.ok(SPLASH_MS <= 4000);
  assert.ok(LOADER_CYCLE_MS <= 4000);
  assert.deepEqual(LOADER_BEATS, [0, LOADER_CYCLE_MS]);
  assert.deepEqual(LOADER_PHASES.map(phase => phase.id), ['dots', 'ring', 'logo']);
  assert.equal(LOADER_PHASES.at(-1).until, 1);
});

test('the loader loop is seamless across cycle boundaries', () => {
  const start = loaderScene(0);
  const end = loaderScene(LOADER_CYCLE_MS - 0.001);
  let largest = 0;
  for (let y = -20; y <= 375; y += 5) {
    for (let x = -20; x <= 375; x += 5) {
      largest = Math.max(largest, Math.abs(sceneDistance(x, y, start) - sceneDistance(x, y, end)));
    }
  }
  assert.ok(largest < 0.5, `boundary frames differ by ${largest}`);
  assert.equal(tracePath(loaderScene(LOADER_CYCLE_MS * 3 + 250), 60), tracePath(loaderScene(250), 60));
});

test('one loader cycle changes topology in a single clean order', () => {
  // Contours count pieces plus holes: logo 3 → four dots 4 → ring 2 (body and
  // hole) → one body 1 → logo 3. No flicker, stray fragment or reopened hole.
  const sequence = [];
  for (let time = 0; time <= LOADER_CYCLE_MS; time += 10) {
    const count = contourCount(loaderScene(time % LOADER_CYCLE_MS));
    if (sequence.at(-1) !== count) sequence.push(count);
  }
  assert.deepEqual(sequence, [3, 4, 2, 1, 3]);
  for (const phase of LOADER_PHASES) {
    const probe = loaderScene((phase.until - 0.02) * LOADER_CYCLE_MS);
    assert.equal(probe.phase, phase.id);
  }
});

test('the startup mark swirls in from nothing, rings, merges and unfolds', () => {
  assert.equal(tracePath(splashScene(0), 60), '');
  assert.equal(contourCount(splashScene(300)), 4);
  assert.equal(contourCount(splashScene(560)), 2);
  assert.equal(contourCount(splashScene(900)), 1);
  assert.equal(contourCount(splashScene(SPLASH_MS)), 3);
});

test('loader motion stays inside its viewBox margin at every frame', () => {
  const [minX, minY, width, height] = LOADER_VIEWBOX;
  for (let time = 0; time < LOADER_CYCLE_MS; time += 20) {
    const numbers = tracePath(loaderScene(time), 56).match(/-?\d+(?:\.\d+)?/g).map(Number);
    for (let i = 0; i < numbers.length; i += 2) {
      assert.ok(numbers[i] >= minX && numbers[i] <= minX + width, `x ${numbers[i]} escapes at ${time}ms`);
      assert.ok(numbers[i + 1] >= minY && numbers[i + 1] <= minY + height, `y ${numbers[i + 1]} escapes at ${time}ms`);
    }
  }
});
