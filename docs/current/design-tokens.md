# Design Tokens

The shared visual interface lives in `static/css/design-tokens.css`. It is the
only place that should define product-wide palette, semantic color, typography,
spacing, radius, elevation, motion, and layering decisions.

## Token tiers

1. **Primitive tokens** describe raw choices such as palette steps and spacing.
   They use names such as `--ui-palette-gray-500` and `--ui-space-4`.
2. **Semantic tokens** describe intent. UI code should normally use names such
   as `--ui-color-text-tertiary`, `--ui-color-surface`, and `--ui-shadow-raised`.
3. **Module tokens** are allowed next to a module when its implementation needs
   a narrower concept. They must reference semantic tokens rather than repeat a
   raw color, shadow, radius, or easing value.

Neutral endpoints use `--ui-palette-gray-0` and
`--ui-palette-gray-1000` as their canonical primitive names. The redundant
`--ui-palette-white` and `--ui-palette-black` aliases have been removed; code
that needs these raw endpoints must use the gray-scale names, while product UI
should normally continue to consume semantic `--ui-color-*` tokens.
Complete transparency uses the editable eight-digit HEX primitive
`--ui-palette-transparent: #00000000`; semantic mappings and translucent color
recipes reference that primitive instead of spelling `transparent` or
`rgba(0, 0, 0, 0)` directly.

Palette families use a sparse numeric `0`–`1000` scale and expose only color
steps that a semantic mapping actually needs. An opaque semantic color must map
to a palette step instead of computing a private tint with `color-mix()`.
Transparent surfaces, shadows, Backdrops and Masks may retain an explicit
alpha recipe because their result depends on the content beneath them rather
than representing another opaque palette color.

Renamed semantic colors do not keep compatibility aliases. A completed token
migration updates every consumer and removes the former declaration, so the
interface has one canonical name for each responsibility.

## Semantic color grammar

Semantic color names begin with the visual responsibility they serve. The
shared dimensions are importance (`primary`, `secondary`, `tertiary`), intent
(`success`, `warning`, `danger`), and interaction state (`hover`, `disabled`,
`selected`). A family exposes only combinations that have a real
use; the dimensions are not a Cartesian-product requirement.
Transient Pressed feedback does not own a semantic color. Action components
express it with motion while retaining their current Default or Hover color;
persistent toggle state continues to use Selected colors and `aria-pressed`.

| Family | Responsibility |
| --- | --- |
| `surface-*` | Static, non-operable UI containers |
| `action-*` | Operable containers and their interaction states |
| `text-*` | Text foregrounds, including Placeholder, Link, Caret, fixed white, and intent |
| `icon-*` | Independently colored icons; paired icons inherit text `currentColor` |
| `border-*` | Borders, separators, Focus, selection outlines, and Canvas grid |

`--ui-color-border-segmented-control` is the Segmented Control container Border role. It resolves to `--ui-palette-gray-100` in both themes; the selected Item uses the shared `--ui-color-border-secondary` role instead.

`--ui-color-border-nodes` is the default outer-shell Border role shared by concrete Smart Canvas Nodes. It resolves to `gray-300` in Light and `gray-700` in Dark. Ordinary Node Hover retains this Border and expresses elevation through Shadow; Selected Nodes switch to the shared Focus Border. Frame keeps its semantic frame color, while Text Annotation and Brush Stroke have no concrete outer-shell Border.

`--ui-color-border-connections` is the default Smart Canvas Connection role. It resolves to `gray-400` in Light and `gray-500` in Dark; Hover, Selected, and running cascade Connections continue to use their dedicated state colors.

Surface uses `surface-canvas`, `surface`, `surface-subtle`, and
`surface-floating`; it has no global Hover, Pressed, Disabled, or Selected
states. A non-clickable Table may use `surface-subtle` as a component-owned row
locator on Hover without turning Surface into an interactive family. Slider
Thumbs compose `surface` with `border-primary`; there is no global Control Thumb
color family.

Primary Action reverses by theme: a dark fill with
`text-on-action-primary` white in Light, and a light fill with the same token
resolving dark in Dark. `text-white` is a separate fixed white foreground for
media and Mask content and never substitutes for that paired Action text.
Primary Danger is the explicit exception: `text-on-action-primary-danger`
resolves to fixed white in both themes. Tertiary Danger Hover uses `red-50`
(`#FFF0F2`) in Light and `gray-800` in Dark.
`info` remains available to component and business tone APIs but owns no
semantic color; it renders with the neutral Surface, Text, Icon, and Border
families. Success, Warning, and Danger remain color intents. Only Danger has
Action combinations until another intent has a demonstrated interactive need.

Blue is restricted to `text-link`, `text-caret`, and `border-selected`.
The former Accent family is removed.

Input and Textarea placeholder copy, including placeholder copy simulated by an
empty editable Composer, uses `--ui-color-text-placeholder`. It resolves to
`gray-400` in Light and `gray-500` in Dark; component or page styles must not
substitute Tertiary text or apply additional opacity.

## Typography

Product UI chooses a semantic text role before choosing individual font
properties. Prefer the complete `--ui-text-*` shorthand because it keeps font
family, size, weight, and line height coherent. Primitive typography tokens may
be used independently for component sizing, data visualization, or a documented
responsive exception; they must not create an unnamed parallel text style.

| Text style | Use | Do not use for |
| --- | --- | --- |
| `title-1` | Page or high-emphasis task title, normally once per page | Card titles |
| `title-2` | Major page section or Dialog title | Every nested group |
| `title-3` | Card, panel, or small section title | Body emphasis |
| `subtitle` | Introductory summary immediately following a title | Generic secondary body text or labels |
| `body` | Default prose, form help, and multi-line reading | Dense metadata rows |
| `body-compact` | Short copy in Tables, Menus, and Popovers | Long-form reading |
| `label` | Short Button, field, navigation, and status labels | Full explanatory sentences |
| `caption` | Time, count, source, and non-critical metadata | Primary content or actions |
| `code` | Token names, paths, shortcuts, IDs, and code | Ordinary prose or numeric values |

Use `regular` for reading, `medium` for restrained heading or label emphasis,
and `bold` for the highest short-text emphasis. `bold` intentionally resolves
to weight `600`; there is no separate Semibold alias. Body and Chinese text use
`letter-spacing-normal`. `tight` and `tighter` are restricted to headings;
`wide` and `widest` are restricted to short Latin eyebrow or marker text.

The eight-step font-size ramp remains primitive and numeric. Steps 1–6 support
the product text roles; steps 7–8 are display sizes for rare Hero or empty-state
moments and do not add two more routine heading levels. Within one region, keep
at most three visibly distinct text levels. Caption is not a substitute for
de-emphasizing long text, and letter spacing must not be used to repair Chinese
readability. Long-form text should normally stay within 45–75 characters per
line.

## Size naming

Comparable size families use one suffix scale: `xs`, `s`, `m`, `l`, and `xl`.
A family exposes only the steps it actually supports. Radius additionally uses
`none` and `pill` for special shapes; these are not positions on the size scale.
For example, use `--ui-radius-m`, `--ui-control-height-m`,
`--ui-icon-size-m`, and `--ui-icon-stroke-width-m`.

Numeric scales remain numeric when the number communicates a reusable measured
step, as in `--ui-space-4` and `--ui-font-size-3`. Semantic families remain
intent-named, as in `--ui-shadow-raised`, `--ui-motion-duration-fast`, and
`--ui-z-popover`. Do not translate these families into arbitrary size letters.

## Elevation

Shared box shadows use exactly four ordered semantic levels. Components choose
the level by spatial responsibility rather than inventing a local shadow or
naming the token after one particular component type.

| Level | Value | Responsibility |
| --- | --- | --- |
| `--ui-shadow-none` | `none` | Flat surfaces and controls with no elevation |
| `--ui-shadow-raised` | `0 1px 3px 0 rgba(0, 0, 0, 0.05)` | Slightly raised cards and controls |
| `--ui-shadow-overlay` | `0 8px 10px -5px rgba(0, 0, 0, 0.15)` | Menus, Popovers, floating toolbars, and transient overlays |
| `--ui-shadow-modal` | `0 25px 50px -12px rgba(0, 0, 0, 0.25)` | Dialogs and modal task surfaces |

The former component-specific `--ui-shadow-popover` name is removed. Transient
overlays normally use `--ui-shadow-overlay`; the lower-elevation anchored
suggestion surface `ic-mention-picker` explicitly uses `--ui-shadow-raised`.
The former color-only `--ui-color-shadow` and `--ui-color-shadow-strong`
helpers are also removed. First-party surfaces and the component-engine adapter
consume the complete elevation levels; legacy SVG Filter, Text Shadow, and
Inset effects that cannot accept a complete Box Shadow resolve to
`--ui-shadow-none` instead of preserving a separate global shadow-color scale.

## Themes

Light is the default adapter. Dark mode is selected by `.theme-dark`,
`.studio-theme-dark`, or `data-ui-theme="dark"` on `html`. Both adapters
implement the same semantic token interface, so page styles do not need separate
theme selectors.

`data-ui-scope` selects a product-area adapter such as `canvas`, `settings`, or
`studio-shell`. Scope adapters preserve intentional visual differences during
the migration without returning token ownership to individual pages. They all
implement the same interface and live in the central token file.

The Reroll UI Theme Adapter lives at
`static/js/infinite-canvas-ui/theme-adapter.js`. It is the only first-party
module allowed to translate the project-owned semantic interface into an
internal component engine's variables. Business pages and component fixtures
must continue to consume `--ui-*`; they must not depend on `--wa-*` or a Vendor
path.

The adapter translates the engine interface; it does not own a migrated UI
family's concrete control implementation. Family-specific Size, State, Variant,
Shadow DOM and engine-presentation rules live with the owning family module.
The migrated Actions, Text Entry, Selection / Adjustment, Dialog / AI Processor,
and Navigation / Command modules now follow this rule. Each stable family entry
hides its internal directory, where every public control has an independently
locatable implementation file. Family `styles.js` files own shared Light DOM or
engine-presentation rules; native Navigation controls keep presentation inside
their own Shadow DOM files. Contracts and fixtures remain separate evidence
artifacts and do not define production CSS. This ownership rule is recorded in
[ADR-0002](../adr/0002-ui-family-module-ownership.md).

## Density, focus, and motion contexts

Density is a page or region context selected with `data-ui-density`. The
central file owns the complete interface for all three values:

| Context | Control height | Icon size | Intended use |
| --- | --- | --- | --- |
| `medium` | `--ui-control-height-m` | `--ui-icon-size-m` | Default sustained desktop work |
| `small` | `--ui-control-height-s` | `--ui-icon-size-s` | Toolbars and Smart Canvas overlays |
| `large` | `--ui-control-height-l` | `--ui-icon-size-l` | Entry, onboarding, and high-emphasis contexts |

Components consume the current density through `--ui-density-*` aliases.
Changing density therefore does not create a component variant or require a
page-level raw size.

`--ui-color-backdrop` belongs to page-blocking Dialog, Drawer, and Lightbox
backgrounds. `--ui-color-mask` is the single local black-alpha color used over
media or other local content. Gradient direction and stops belong to the
component style; Prompt Template cards derive their compact legibility gradient
from the one Mask color rather than exposing three global gradient-stop colors.

Prompt Template cards without a cover use six fixed, same-hue two-stop
`--ui-color-prompt-template-placeholder-*` gradients. The first stop keeps the
former surface luminance while increasing saturation, and the second stop is a
darker value of the same hue; every endpoint preserves readable white text.
They deliberately keep the same values in Light and Dark themes because the
card is a media-like content surface, not a page background.

Focus is also centralized. Components use the single-color, one-pixel
`--ui-color-border-focus` outline through `--ui-focus-ring-width`,
`--ui-focus-ring-offset`, and `--ui-focus-ring`. It resolves to `gray-500` in Light and `gray-400` in Dark.
The negative offset equals the outline width, so
the indicator draws inward and remains visible inside clipped or scrollable
controls. Every first-party rule that consumes `--ui-focus-ring` must also
consume `--ui-focus-ring-offset`. The former blue color and inner separator ring
are removed; `--ui-focus-ring-shadow` therefore resolves to `none`. Pages must
not invent a different raw outline or glow.

Motion uses `data-ui-motion="standard|reduced"`. The central reduced adapter and
the `prefers-reduced-motion: reduce` media query both collapse duration to the
project's reduced duration, remove motion distance, and cap iteration. This is
a user context, not a per-component state or variant.
Transient Action press feedback uses the shared `press` and `release` durations:
press accelerates inward for `90ms`, while release returns with the shared
`spring` easing over `240ms`. Reduced Motion collapses both durations and the
Actions family removes the scale delta.

## Layering

Layer tokens are semantic fallback slots for ordinary DOM and for ordering
inside one active overlay scope. Their required back-to-front order is
`base < raised < sticky < drag-preview < popover < backdrop < modal < toast < tooltip`.
Concrete values live only in `design-tokens.css`; pages must not override a
`--ui-z-*` token or create page-specific arithmetic to outrank a shared
component.

Shared Dialog, Menu, Popover, Tooltip, generation-settings picker, and Toast
components use the browser Top Layer when it is available. Top Layer ordering,
not an extreme `z-index`, lets a component escape transformed or clipped
ancestors and appear within the active Modal task. The numeric tokens remain
necessary for compatible browsers, custom Backdrops, and local non-Top-Layer
content. The complete scope, mounting, and acceptance rules live in
[`ui-design-guidelines.md`](ui-design-guidelines.md#3-浮层与层级规范).

## Usage

```css
.example-panel {
    padding: var(--ui-space-4);
    border: 1px solid var(--ui-color-border-secondary);
    border-radius: var(--ui-radius-l);
    color: var(--ui-color-text-primary);
    background: var(--ui-color-surface);
    box-shadow: var(--ui-shadow-raised);
    transition: border-color var(--ui-motion-duration-normal)
        var(--ui-motion-ease-standard);
}
```

Every HTML entry point must load `design-tokens.css` before page styles. A
regression test enforces this seam and verifies that the token interface exposes
both light and dark adapters.

Human-facing layout, component, Focus, interaction and acceptance rules live in
[`ui-design-guidelines.md`](ui-design-guidelines.md). Token changes must be
verified in the affected real pages and public component behavior tests; an
audit snapshot or generated contract is not required.

## Administrator workbench

The first item in `/ui-component-library` is the Administrator-only Design
Token workbench. Its read view continues to show every declaration discovered
in `design-tokens.css` as a three-column reference: Token Name, usage rule, and
Value. Value keeps the authored mapping and the theme-resolved concrete value
together, so a reviewer can understand both the design decision and the result
without switching tools. The Semantic Color category also documents the naming
anatomy, primitive-to-semantic-to-component mapping, and the responsibilities
of Surface, Text / Icon, Border, and Action. This guide explains the project
contract; it does not introduce a second Token source.

Usage rules are derived from this Current contract and any declaration-specific
source comment. A semantic rule describes responsibility and pairing rather
than merely repeating a color name. Token names and editable palette choices
use natural name ordering, so numeric steps remain `gray-0`, `gray-50`,
`gray-100`, `gray-200` through `gray-1000` instead of character-by-character
ordering.

Category browsing reuses the shared Section Navigation pattern in a persistent
left column. Each category item shows its Token count. The selected category
expands its stable family links beneath it—for example, Semantic Color expands
Action, Border, Surface, Text, and the remaining semantic families—and a family
link moves directly to that table. On narrow screens the same navigation keeps
its hierarchy above the results instead of becoming a separate filter pattern.

Within a selected category, the workbench divides Tokens into stable browsing
families instead of mixing the category into one long table. Every family has
its own `H2` and its own Token Name / usage rule / Value table; every Token is
shown in exactly one named family, and there is no ambiguous “Other” group.
Semantic colors use Action, Border, Surface, Text, Icon, Backdrop, Mask,
and Prompt Template Placeholder in that fixed order. Palette families use Gray,
Blue, Green, Amber, Red, Transparent, and Brand. Typography uses Text Style, Font, Font Size,
Font Weight, Line Height, and Letter Spacing. The remaining categories use the
same fixed-family rule for their named prefixes.

Within a family, natural numeric order still applies. Each base or
purpose-specific Token stays together with its own interaction-state Tokens
before the next base or purpose begins. That local state sequence is Default,
Hover, Pressed, Selected, Selected Hover, then Disabled. Search keeps the family
sections but omits every family without a match. On narrow screens each table
may become cards, while the family `H2` remains the parent heading. Copy, edit,
simultaneous Light/Dark color previews, review, discard, and save keep the same
behavior in grouped browsing. Both color previews are square so their area can
be compared directly without changing the active page theme.

Edit mode deliberately exposes only two safe forms:

1. literal HEX values owned by `--ui-palette-*` primitive color tokens;
2. simple `--ui-color-*` semantic mappings whose Light and Dark values each
   reference an editable palette token.

Translucent `color-mix()` recipes, fixed semantic colors, typography, spacing,
shape, sizing, Focus, motion and layering remain read-only in this first
editing contract. Opaque semantic colors are simple palette mappings and are
therefore editable here. Module-owned `--ic-*`, page-owned `--smart-*` and
other business-local variables are not part of this workbench and remain
beside their owning module.

Editing creates a browser-local draft and appends temporary custom-property
overrides for immediate Light/Dark preview. It does not alter the source until
the Administrator reviews the old and new values and confirms Save. Leaving
the page with a draft warns before navigation; Discard removes every temporary
override.

`GET /api/admin/design-tokens` returns the editable interface plus a source
revision. `PUT /api/admin/design-tokens` accepts only the structured primitive
or semantic mapping changes and the revision originally loaded by the caller.
The server rejects unknown and module tokens, malformed HEX colors, missing
palette references, duplicates and stale revisions. A successful write
replaces `design-tokens.css` atomically and keeps that CSS file as the single
source of truth; the workbench does not create a second token store. If the
installation source is not writable, the draft remains visible and the Save
failure is reported without claiming success.
