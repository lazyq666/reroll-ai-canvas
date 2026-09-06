# Libraries.dev motion engines

Pinned upstream: [Libraries.dev](https://github.com/Jakubantalik/Libraries.dev/tree/999866f33df216dab0f8956f91c8d2e918d46328), commit `999866f33df216dab0f8956f91c8d2e918d46328`.

- Thinking Orbs 0.3.1: original pure geometry / Canvas 2D engine, MIT. The `orbs.ts` build entry exposes only the 20px breathing ring and painter; the full mode registry and unused geometry builders are excluded from the browser bundle. Upstream source remains available for provenance.
- Metal Fx 1.0.4: original renderer and glow engine, MIT. Unused reflection engine and React wrapper omitted.
- Paper Shaders 0.0.80: original liquid-metal fragment shader bundled at build time, Apache-2.0. Original vertex shader is included by Metal. See `metal-fx.NOTICE` and `paper-shaders.LICENSE`.
- Gooey: Reroll's menu adapter uses the silhouette / crisp-content split and SVG blur / alpha-contrast / composite sequence from liquid-gooey 0.2.1. See `liquid-gooey.LICENSE`. It is a native menu-specific adaptation, not the React component. The page's `sites/home/gooey.html` agent prompt and `sites/gooey/playground/demos/PlusMenu.tsx` are the reference: full-size merging circles, blur 6 / contrast 18, 550ms bouncy opening with 40ms stagger, delayed icon reveal, and 250ms closing with a 5px / 700ms whole-layer recoil. Backgrounds and borders share the filtered silhouette; crisp content stays in DOM. The settled SVG is retained without an idle animation loop.

Sources under `src/` retain upstream code except the small `orbs.ts` and `metal.ts` build entries and two Reroll rendering adjustments: `perfConfig.ts` retains 15 FPS; `renderer/loop.ts` preserves throttle remainder and supersamples the visible ring at twice device DPR (capped at 4). Shared shader resolution and glow sampling remain unchanged. Generated `orbs.js` and `metal.js` have no React imports or external runtime dependencies. Reroll owns lifecycle, themes and motion settings in the consuming UI modules. Resources are served locally; no runtime CDN or Libraries.dev account is needed.

Rebuild after `npm ci` with `npm run build:motion`. The root lockfile pins esbuild and Paper Shaders. Commit source, license files and generated bundles together. For an upstream update use a new commit-named directory and update the consuming imports so caches cannot keep an old engine.
