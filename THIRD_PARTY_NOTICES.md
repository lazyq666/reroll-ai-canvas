# Third-party notices

This repository is a non-commercial derivative of
[`hero8152/Infinite-Canvas`](https://github.com/hero8152/Infinite-Canvas).
The repository-level [`LICENSE`](LICENSE) applies to this derivative source;
third-party components remain under the licenses named below.

## Bundled runtime components

| Component | Bundled path | Version / identity | License | Source |
| --- | --- | --- | --- | --- |
| Tailwind CSS Play CDN | `static/vendor/js/tailwindcss-cdn.js` | 3.4.17, SHA-256 `176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15` | MIT | [`cdn.tailwindcss.com/3.4.17`](https://cdn.tailwindcss.com/3.4.17) |
| Lucide | `static/vendor/js/lucide.js` | 1.16.0, SHA-256 `187a756625c5ce7499c207d1b0d1cf4e1ab95e3f666c7e0cd0fafc3e6842d040` | ISC; listed Feather-derived icons retain MIT | [`lucide@1.16.0`](https://unpkg.com/lucide@1.16.0/dist/umd/lucide.min.js) |
| three.js | `static/vendor/js/three-0.160.0.module.js` | r160 / 0.160.0, SHA-256 `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495` | MIT | [`three@0.160.0`](https://unpkg.com/three@0.160.0/build/three.module.js) |
| Web Awesome | `static/vendor/webawesome/3.10.0/` | 3.10.0; archive and extracted-tree integrity recorded in its `release.json` | MIT | [`@awesome.me/webawesome`](https://www.npmjs.com/package/@awesome.me/webawesome/v/3.10.0) |

Full license texts are bundled under `static/vendor/licenses/`; Web Awesome
also retains the license shipped in its original package.

## Bundled fonts

| Font | Bundled path | License | Upstream |
| --- | --- | --- | --- |
| Inter | `static/vendor/fonts/inter-*.ttf` | SIL Open Font License 1.1 | [`rsms/inter`](https://github.com/rsms/inter) |
| JetBrains Mono | `static/vendor/fonts/jetbrains-mono-*.ttf` | SIL Open Font License 1.1 | [`JetBrains/JetBrainsMono`](https://github.com/JetBrains/JetBrainsMono) |
| Space Grotesk | `static/vendor/fonts/space-grotesk-*.ttf` | SIL Open Font License 1.1 | [`floriankarsten/space-grotesk`](https://github.com/floriankarsten/space-grotesk) |

The corresponding OFL texts are bundled under `static/vendor/licenses/`.

## Icons, provider marks, and service names

- Lobe Icons assets retain the MIT notice in
  `static/images/providers/LICENSE.lobe-icons.txt`.
- Names and logos for providers and services—including ChatGPT, Gemini,
  Midjourney, ModelScope, RunningHub, Volcengine, Jimeng, Doubao, Flux, Grok,
  and their respective marks—belong to their owners. They are included only
  to identify compatible services and are not licensed under this project's
  repository-level license. No endorsement or affiliation is implied.

If a bundled asset is missing from this notice, treat that as a release bug:
do not redistribute it until its source and license have been recorded or the
asset has been replaced with a project-owned fixture.

The media under `static/images/test/` and the placeholders under
`static/runninghub/thumbnails/` are project-owned synthetic fixtures; their
local README files record how they were created.
