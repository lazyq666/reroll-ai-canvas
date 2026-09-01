# Local Vendor Assets

This folder contains third-party assets mirrored locally so the app can load without CDN access.

## JavaScript

- `js/tailwindcss-cdn.js`: fixed mirror of `https://cdn.tailwindcss.com/3.4.17`
  (SHA-256 `176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15`)
- `js/lucide.js`: fixed mirror of `https://unpkg.com/lucide@1.16.0/dist/umd/lucide.min.js`
  (SHA-256 `187a756625c5ce7499c207d1b0d1cf4e1ab95e3f666c7e0cd0fafc3e6842d040`)
- `js/three-0.160.0.module.js`: local mirror of `https://unpkg.com/three@0.160.0/build/three.module.js`
  (SHA-256 `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495`)

License texts for these snapshots are stored under `licenses/` and summarized
in the repository root `THIRD_PARTY_NOTICES.md`.

## UI engine

- `webawesome/3.10.0/`: complete, fixed `@awesome.me/webawesome@3.10.0`
  Core npm release. The original archive, exact extracted package, MIT license,
  official sources, version, commit and integrity hashes live together in that
  directory. Runtime modules use only its local `package/dist-cdn/` files.
- Verify the archive and every extracted file with
  `python scripts/verify_webawesome_vendor.py` from the repository root.

## CSS

- `css/fonts.css`: local `@font-face` declarations used by all pages.

## Fonts

- `fonts/inter-5.ttf`: Inter 300
- `fonts/inter-4.ttf`: Inter 400
- `fonts/inter-3.ttf`: Inter 500
- `fonts/inter-2.ttf`: Inter 600
- `fonts/inter-1.ttf`: Inter 800
- `fonts/jetbrains-mono-7.ttf`: JetBrains Mono 400
- `fonts/jetbrains-mono-6.ttf`: JetBrains Mono 700
- `fonts/space-grotesk-9.ttf`: Space Grotesk 300
- `fonts/space-grotesk-10.ttf`: Space Grotesk 500
- `fonts/space-grotesk-8.ttf`: Space Grotesk 700

The fonts retain their upstream SIL Open Font License 1.1 terms. Exact license
texts and upstream links are stored under `licenses/` and in
`THIRD_PARTY_NOTICES.md`.
