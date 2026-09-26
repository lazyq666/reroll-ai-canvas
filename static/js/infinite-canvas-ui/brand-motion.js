// Vector brand motion for the Reroll mark: the startup mark and the brand
// loader. The logo is modelled as four signed-distance shapes (two rounded
// squares, two circles). Motion is fluid topology — pieces merge, split and
// enclose holes, joined by short, thick liquid bridges — and the exact
// circular-fillet neck of the logo returns at rest. Every frame is traced from
// that field into one SVG path, so shapes stay crisp at any size and inherit
// `currentColor`. The module is pure: no DOM access, so it also runs in Node.


export const VIEWBOX = 355;
export const CENTER = { x: 177.5, y: 178 };
// Loaders keep a 24-unit margin so every trick stays inside their box.
export const LOADER_VIEWBOX = [-24, -24, VIEWBOX + 48, VIEWBOX + 48];

// Exact source geometry from static/images/brand/logo.svg.
export const LOGO_PATH = 'M3 71C3 33 34 2 72 2H106C145 2 176 33 176 72V119C176 153 204 181 238 181H283C321 181 352 211 352 249V285C352 323 321 354 283 354H247C209 354 179 323 179 285V238C179 203 151 175 116 175H72C34 175 3 144 3 106V71Z'
  + 'M324 58A52 52 0 1 1 220 58A52 52 0 1 1 324 58Z'
  + 'M122 278A54 54 0 1 1 14 278A54 54 0 1 1 122 278Z';

// Slots run clockwise: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
// Corner radii are [tl, tr, br, bl]; the corners facing the neck are sharp and
// buried inside the fillet, exactly like the source outline.
const LOGO_POSES = [
  { x: 89.5, y: 88.5, hx: 86.5, hy: 86.5, r: [69, 70, 0, 69] },
  { x: 272, y: 58, hx: 52, hy: 52, r: [52, 52, 52, 52] },
  { x: 265.5, y: 267.5, hx: 86.5, hy: 86.5, r: [0, 68.5, 69, 68.5] },
  { x: 68, y: 278, hx: 54, hy: 54, r: [54, 54, 54, 54] },
];
// The source neck arcs have radii 62 and 63.
const NECK = 62.5;
// Polynomial blend radii used while pieces move. Their bulges stay round, so
// bridges read as liquid; pieces only bridge when nearly touching, which keeps
// every bridge short and thick.
const BLEND = 96;
const SLOT_DIRECTIONS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const QUARTER = Math.PI / 2;

export const SPLASH_MS = 1600;
// One loader cycle: logo → four dots → ring → logo, a quarter turn clockwise.
// Only the cycle boundary is the exact logo, so that is the clean place to stop.
export const LOADER_CYCLE_MS = 2000;
// What a viewer sees, as fractions of the cycle: the dots are apart until the
// ring's bridges form, and the ring lasts until its hole closes.
export const LOADER_PHASES = [
  { id: 'dots', until: 0.48 },
  { id: 'ring', until: 0.665 },
  { id: 'logo', until: 1 },
];
export const LOADER_BEATS = [0, LOADER_CYCLE_MS];

// ------------------------------------------------------------------ easing
// Viscous motion only: every curve eases in and out and never overshoots.

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);
const lerp = (from, to, amount) => from + (to - from) * amount;
const span = (time, start, end) => clamp01((time - start) / (end - start));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = t => 1 - (1 - t) ** 3;
// Slows to `1 - amount` of the average speed at both ends and never stops, so
// consecutive segments flow into each other with a gentle beat on each pose.
const dwell = (t, amount) => t - (amount * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);

// ------------------------------------------------------------------- poses

function logoPose(slot) {
  const pose = LOGO_POSES[slot];
  return { ox: pose.x - CENTER.x, oy: pose.y - CENTER.y, hx: pose.hx, hy: pose.hy, r: pose.r.slice() };
}

function circleAt(ox, oy, radius) {
  return { ox, oy, hx: radius, hy: radius, r: [radius, radius, radius, radius] };
}

// Express a screen-space pose inside a frame that will be rotated clockwise by
// `turns` quarter turns: offsets rotate back and each local corner inherits the
// screen corner it will land on.
function unrotate(pose, turns) {
  let next = pose;
  for (let i = 0; i < turns; i += 1) {
    next = { ox: next.oy, oy: -next.ox, hx: next.hy, hy: next.hx, r: [next.r[1], next.r[2], next.r[3], next.r[0]] };
  }
  return next;
}

// A neck-facing corner only turns sharp once the neck already hides it, and
// rounds off first when the neck releases, so no bare right angle ever shows.
function cornerAmount(from, to, amount) {
  if (to <= 1) return smoothstep(0.62, 1, amount);
  if (from <= 1) return smoothstep(0, 0.38, amount);
  return amount;
}

function mixPose(from, to, amount) {
  return {
    ox: lerp(from.ox, to.ox, amount),
    oy: lerp(from.oy, to.oy, amount),
    hx: lerp(from.hx, to.hx, amount),
    hy: lerp(from.hy, to.hy, amount),
    r: from.r.map((value, index) => lerp(value, to.r[index], cornerAmount(value, to.r[index], amount))),
  };
}

// Place a local pose in screen space inside a frame rotated clockwise by `frame`.
function place(pose, frame = 0) {
  const cos = Math.cos(frame);
  const sin = Math.sin(frame);
  const hx = Math.max(0, pose.hx);
  const hy = Math.max(0, pose.hy);
  const limit = Math.min(hx, hy);
  return {
    x: CENTER.x + pose.ox * cos - pose.oy * sin,
    y: CENTER.y + pose.ox * sin + pose.oy * cos,
    hx,
    hy,
    r: pose.r.map(value => Math.min(limit, Math.max(0, value))),
    cos,
    sin,
  };
}

// ---------------------------------------------------------------- blending

// Union with an exact circular fillet of radius k (hg_sdf fOpUnionRound).
function roundUnion(a, b, k) {
  if (k <= 0.01) return a < b ? a : b;
  const u = k - a > 0 ? k - a : 0;
  const v = k - b > 0 ? k - b : 0;
  return Math.max(k, a < b ? a : b) - Math.sqrt(u * u + v * v);
}

// Quadratic polynomial smooth minimum. Two shapes bridge once their gap is
// under k / 2, and the bridge is widest when they almost touch.
function smoothUnion(a, b, k) {
  if (k <= 0.01) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

function pairDistance(a, b, pair) {
  if (pair.rest <= 0) return smoothUnion(a, b, pair.blend);
  const settled = roundUnion(a, b, NECK);
  if (pair.rest >= 1) return settled;
  return lerp(smoothUnion(a, b, pair.blend), settled, pair.rest);
}

// Diagonal pairs (0, 2) and (1, 3), optionally bridged to each other.
function pairsCombine(first, second, cross = 0) {
  return (d0, d1, d2, d3) => smoothUnion(pairDistance(d0, d2, first), pairDistance(d1, d3, second), cross);
}

// --------------------------------------------------------------- startup

const SPLASH_TURN = 1.25 * Math.PI;
const LEAN_OUT = 12;
const LEAN_IN = 8;
const LEAN_TWIST = (10 * Math.PI) / 180;

/**
 * Startup mark (1.6 s): four droplets swirl in clockwise and bridge into a
 * ring around a hole; the hole seals into one liquid body that keeps flowing
 * one way, twisting into the diagonal; then, still turning, the body
 * unfolds into the logo — the diagonal stretches out while two buds pinch off
 * as the circles. Topology: 4 pieces → ring → 1 → 3.
 */
export function splashScene(time) {
  // One clockwise turn that slows gently and stops without overshoot; about
  // 80deg of it remains when the body starts to unfold.
  const frame = -SPLASH_TURN * (1 - span(time, 0, SPLASH_MS)) ** 1.6;
  const approach = easeOutCubic(span(time, 0, 520));
  const drift = smoothstep(520, 660, time);
  const seal = easeInOutCubic(span(time, 640, 820));
  // Once sealed, the body flows one way only — no oscillation: it twists and
  // leans into the diagonal it will unfold along, hinting at the logo's S.
  const lean = smoothstep(700, 1080, time);
  const distance = lerp(lerp(250, 72, approach) - 6 * drift, 42, seal);
  const size = lerp(38 * easeOutCubic(span(time, 0, 380)) + 2 * drift, 50, seal);
  // The diagonal stretches out first; the buds follow and pinch off its sides.
  const stretch = easeInOutSine(span(time, 780, 1460));
  const bud = easeInOutSine(span(time, 900, SPLASH_MS));

  const elements = SLOT_DIRECTIONS.map(([dx, dy], slot) => {
    const diagonal = slot % 2 === 0;
    const reach = (distance + (diagonal ? LEAN_OUT : -LEAN_IN) * lean) * Math.SQRT1_2;
    const twist = (diagonal ? LEAN_TWIST : -LEAN_TWIST) * lean;
    const cos = Math.cos(twist);
    const sin = Math.sin(twist);
    const droplet = circleAt((dx * cos - dy * sin) * reach, (dx * sin + dy * cos) * reach, size);
    const unfold = diagonal ? stretch : bud;
    return place(unfold > 0 ? mixPose(droplet, logoPose(slot), unfold) : droplet, frame);
  });

  // Neighbours bridge first (the ring); diagonal blends then fill the hole.
  const fill = smoothstep(680, 820, time);
  const diagonal = { blend: BLEND * fill, rest: smoothstep(1200, 1480, time) };
  const buds = { blend: BLEND * fill * (1 - smoothstep(1020, 1320, time)), rest: 0 };
  const cross = lerp(60, 90, seal) * smoothstep(250, 480, time) * (1 - smoothstep(1140, 1460, time));
  const bounds = time < 600 ? SPLASH_WIDE_BOUNDS : SPLASH_BOUNDS;
  return { elements, combine: pairsCombine(diagonal, buds, cross), bounds };
}

// ------------------------------------------------------------------ loader

const DOT_OFFSET = 86;
const DOT_RADIUS = 44;
const LOBE_OFFSET = 62;
const LOBE_RADIUS = 46;
// Pose keys: the dots are reached at DOTS_KEY, the ring lobes at RING_KEY.
const DOTS_KEY = 0.34;
const RING_KEY = 0.54;
const POSE_DWELL = 0.65;
// The new neck reaches across the ring's hole with a wider blend, then settles
// to the logo's exact fillet.
const NECK_REACH = 110;
// Wider blends while shapes change make pieces cling: bridges reach out
// earlier when joining and stretch longer before they let go.
const STICKY_NECK = 132;
const STICKY_BRIDGE = 112;
// Joining uses a moderate reach, switched on in about 40 ms once the dots are
// close: they coalesce like droplets instead of pressing flat faces together.
const JOIN_BRIDGE = 96;
const SPIN_DWELL = 0.6;

/**
 * Loading loop (2 s): the logo splits into four dots, the dots flow together
 * into a ring around a hole, and a neck closes the hole across the opposite
 * diagonal to land on the logo again. The mark turns a quarter turn clockwise
 * per cycle without ever stopping — slowest on the logo, fastest at the ring.
 * Topology: 3 pieces → 4 → ring → 3.
 */
export function loaderScene(time) {
  const u = ((time % LOADER_CYCLE_MS) + LOADER_CYCLE_MS) % LOADER_CYCLE_MS / LOADER_CYCLE_MS;
  const frame = QUARTER * dwell(u, SPIN_DWELL);
  const elements = SLOT_DIRECTIONS.map(([dx, dy], slot) => {
    const dot = circleAt(dx * DOT_OFFSET, dy * DOT_OFFSET, DOT_RADIUS);
    const lobe = circleAt(dx * LOBE_OFFSET, dy * LOBE_OFFSET, LOBE_RADIUS);
    let pose;
    if (u < DOTS_KEY) pose = mixPose(logoPose(slot), dot, dwell(span(u, 0, DOTS_KEY), POSE_DWELL));
    else if (u < RING_KEY) pose = mixPose(dot, lobe, dwell(span(u, DOTS_KEY, RING_KEY), POSE_DWELL));
    else {
      // Out of the ring the new squares (1, 3) lead and the leaving lobes lag,
      // so the new neck crosses the hole before anything lets go.
      const lead = slot % 2 === 1;
      const settle = lead
        ? dwell(span(u, RING_KEY, 0.82), POSE_DWELL)
        : dwell(span(u, 0.58, 1), POSE_DWELL);
      pose = mixPose(lobe, unrotate(logoPose((slot + 1) % 4), 1), settle);
    }
    return place(pose, frame);
  });
  // The old neck stretches and pinches while the pieces move fast; the ring's
  // bridges snap on as the dots meet; the new neck closes the hole, and only
  // then do the two leaving lobes drag their bridges out and let go.
  const leaving = { blend: STICKY_NECK * (1 - smoothstep(0.26, 0.34, u)), rest: 1 - smoothstep(0.02, 0.14, u) };
  const arriving = { blend: NECK_REACH * smoothstep(0.6, 0.7, u), rest: smoothstep(0.8, 0.98, u) };
  const cross = lerp(JOIN_BRIDGE, STICKY_BRIDGE, smoothstep(0.54, 0.66, u))
    * (smoothstep(0.46, 0.48, u) - smoothstep(0.72, 0.82, u));
  const phase = LOADER_PHASES.find(item => u < item.until) || LOADER_PHASES.at(-1);
  return { elements, combine: pairsCombine(leaving, arriving, cross), bounds: LOADER_BOUNDS, phase: phase.id };
}

// ------------------------------------------------------------------ tracing

function shapeDistance(px, py, shape) {
  if (shape.hx <= 0.01 || shape.hy <= 0.01) return 1e6;
  const dx = px - shape.x;
  const dy = py - shape.y;
  const lx = dx * shape.cos + dy * shape.sin;
  const ly = -dx * shape.sin + dy * shape.cos;
  const radius = lx < 0 ? (ly < 0 ? shape.r[0] : shape.r[3]) : (ly < 0 ? shape.r[1] : shape.r[2]);
  const qx = Math.abs(lx) - shape.hx + radius;
  const qy = Math.abs(ly) - shape.hy + radius;
  const mx = qx > 0 ? qx : 0;
  const my = qy > 0 ? qy : 0;
  return Math.sqrt(mx * mx + my * my) + Math.min(Math.max(qx, qy), 0) - radius;
}

export function sceneDistance(px, py, scene) {
  const [a, b, c, d] = scene.elements;
  return scene.combine(shapeDistance(px, py, a), shapeDistance(px, py, b), shapeDistance(px, py, c), shapeDistance(px, py, d));
}

const SPLASH_BOUNDS = { x0: -40, y0: -40, x1: VIEWBOX + 40, y1: VIEWBOX + 40 };
const SPLASH_WIDE_BOUNDS = { x0: -110, y0: -110, x1: VIEWBOX + 110, y1: VIEWBOX + 110 };
const LOADER_BOUNDS = { x0: -30, y0: -30, x1: VIEWBOX + 30, y1: VIEWBOX + 30 };
const DEFAULT_BOUNDS = { x0: -12, y0: -12, x1: VIEWBOX + 12, y1: VIEWBOX + 12 };
const tracers = new Map();

function tracerFor(density, bounds) {
  const key = `${density}|${bounds.x0},${bounds.y0},${bounds.x1},${bounds.y1}`;
  let tracer = tracers.get(key);
  if (tracer) return tracer;
  const step = VIEWBOX / density;
  const columns = Math.ceil((bounds.x1 - bounds.x0) / step);
  const rows = Math.ceil((bounds.y1 - bounds.y0) / step);
  const width = columns + 1;
  const horizontal = columns * (rows + 1);
  const edges = horizontal + width * rows;
  tracer = {
    columns,
    rows,
    width,
    horizontal,
    step,
    x0: bounds.x0,
    y0: bounds.y0,
    field: new Float64Array(width * (rows + 1)),
    edgeX: new Float64Array(edges),
    edgeY: new Float64Array(edges),
    links: new Int32Array(edges * 2),
    visited: new Uint8Array(edges),
    touched: new Int32Array(edges),
  };
  tracers.set(key, tracer);
  return tracer;
}

/**
 * Trace the zero contour of a scene into an SVG path (fill-rule evenodd).
 * `density` is the number of grid cells across the 355-unit logo.
 */
export function tracePath(scene, density = 96) {
  const tracer = tracerFor(density, scene.bounds || DEFAULT_BOUNDS);
  const { columns, rows, width, horizontal, step, x0: gridX, y0: gridY, field, edgeX, edgeY, links, visited, touched } = tracer;
  for (let j = 0; j <= rows; j += 1) {
    const y = gridY + j * step;
    for (let i = 0; i < width; i += 1) {
      field[j * width + i] = sceneDistance(gridX + i * step, y, scene);
    }
  }
  // Keep the border outside so a shape leaving the grid is clipped, not torn.
  for (let i = 0; i < width; i += 1) {
    if (field[i] < 0.01) field[i] = 0.01;
    if (field[rows * width + i] < 0.01) field[rows * width + i] = 0.01;
  }
  for (let j = 0; j <= rows; j += 1) {
    if (field[j * width] < 0.01) field[j * width] = 0.01;
    if (field[j * width + columns] < 0.01) field[j * width + columns] = 0.01;
  }
  let touchedCount = 0;
  const cut = (id, ia, ib, ax, ay, bx, by) => {
    if (visited[id] === 0) {
      const va = field[ia];
      const t = va / (va - field[ib]);
      edgeX[id] = ax + (bx - ax) * t;
      edgeY[id] = ay + (by - ay) * t;
      visited[id] = 2;
      touched[touchedCount] = id;
      touchedCount += 1;
    }
    return id;
  };
  const link = (a, b) => {
    links[a * 2 + (links[a * 2] === -1 ? 0 : 1)] = b;
    links[b * 2 + (links[b * 2] === -1 ? 0 : 1)] = a;
  };
  links.fill(-1);
  for (let j = 0; j < rows; j += 1) {
    const y0 = gridY + j * step;
    const y1 = y0 + step;
    for (let i = 0; i < columns; i += 1) {
      const i0 = j * width + i;
      const i1 = i0 + 1;
      const i2 = i1 + width;
      const i3 = i0 + width;
      const code = (field[i0] < 0 ? 1 : 0) | (field[i1] < 0 ? 2 : 0) | (field[i2] < 0 ? 4 : 0) | (field[i3] < 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const x0 = gridX + i * step;
      const x1 = x0 + step;
      const top = () => cut(j * columns + i, i0, i1, x0, y0, x1, y0);
      const right = () => cut(horizontal + j * width + i + 1, i1, i2, x1, y0, x1, y1);
      const bottom = () => cut((j + 1) * columns + i, i3, i2, x0, y1, x1, y1);
      const left = () => cut(horizontal + j * width + i, i0, i3, x0, y0, x0, y1);
      const centerInside = field[i0] + field[i1] + field[i2] + field[i3] < 0;
      switch (code) {
        case 1: case 14: link(left(), top()); break;
        case 2: case 13: link(top(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(right(), bottom()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), bottom()); break;
        case 5:
          if (centerInside) { link(top(), right()); link(bottom(), left()); }
          else { link(left(), top()); link(right(), bottom()); }
          break;
        case 10:
          if (centerInside) { link(left(), top()); link(right(), bottom()); }
          else { link(top(), right()); link(bottom(), left()); }
          break;
        default: break;
      }
    }
  }
  let path = '';
  for (let n = 0; n < touchedCount; n += 1) {
    const start = touched[n];
    if (visited[start] !== 2) continue;
    let previous = -1;
    let current = start;
    let guard = touchedCount + 1;
    path += `M${edgeX[current].toFixed(1)} ${edgeY[current].toFixed(1)}`;
    while (guard > 0) {
      visited[current] = 1;
      const first = links[current * 2];
      const next = first !== previous ? first : links[current * 2 + 1];
      if (next === -1 || next === start) break;
      path += `L${edgeX[next].toFixed(1)} ${edgeY[next].toFixed(1)}`;
      previous = current;
      current = next;
      guard -= 1;
    }
    path += 'Z';
  }
  for (let n = 0; n < touchedCount; n += 1) visited[touched[n]] = 0;
  return path;
}
