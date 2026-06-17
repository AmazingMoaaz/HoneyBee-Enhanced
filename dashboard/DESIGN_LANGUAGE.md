# HoneyBee — Unified Design Language

One cohesive visual system for the whole dashboard. Every page should speak this
language: the same radii, spacing rhythm, type ramp, elevation, color tokens, and
shared component classes. The single source of truth is
[`src/index.css`](src/index.css); this doc explains how to use it.

## Principles

1. **Brand is fixed.** The amber/honey family (`#FCD34D / #F59E0B / #D97706`, ink
   `#1C0A00`) and the navy dark theme are immutable identity. Amber always arrives
   as the `.btn-primary` 180° gradient or via `var(--accent)` / `var(--warn)` —
   never a flat `#F59E0B` fill. Per-product / per-pot palette hexes and all
   **SVG-canvas internals** (topology nodes, edges, charts, particle/grid decor)
   are intentional and out of scope.
2. **Tokens, not literals.** Every neutral/semantic color resolves through a CSS
   variable so both themes adapt. Status colors come from
   `--ok / --danger / --warn / --info / --violet` (+ `*-bg` fills and `*-border`).
   Hardcoded `#22C55E / #EF4444 / #3B82F6 / #0F172A` chrome is a theme-blind bug.
   Never concatenate hex-alpha (`` `${color}16` ``) on a `var()` input.
3. **One radius family** — `8 / 12 / 16 / full` (controls grandfathered at 10).
4. **One type ramp** — `11 / 12 / 13 / 14 / 16 / 18 / 24 / 30` at weights
   `500 / 600 / 700 / 800`. No half-steps; weight 900 → 800.
5. **One elevation set** — `--shadow-sm` (resting), `--shadow-md` (raised/hover),
   `--shadow-lg` (popover/menu/modal). All reference `var(--shadow)` so they darken
   correctly in dark mode.
6. **Shared primitives over re-builds.** Tabs, segmented controls, badges, chips,
   menus, modals, toggles, list-rows, stat tiles, empty states each have ONE class.
   Hover/focus/selection live in CSS, not inline `onMouseEnter/Leave`. Selection
   tint is `--sel-amber` (rows) / `rgba(245,158,11,0.12)` (icon buttons).
7. **Motion is systemic.** The global 150ms `cubic-bezier(.4,0,.2,1)` transition and
   the named keyframes cover all chrome. Don't redeclare inline transitions or
   invent undefined keyframes.

## Scale tokens

| Group | Tokens |
|---|---|
| Radius | `--r-sm 8` · `--r-ctl 10` · `--r-md 12` · `--r-lg 16` · `--r-full 999` |
| Spacing | `--space-1 4` · `-2 8` · `-3 12` · `-4 16` · `-5 20` · `-6 24` |
| Type | `--fs-11 … --fs-30` |
| Weight | `--fw-medium 500` · `--fw-semibold 600` · `--fw-bold 700` · `--fw-heavy 800` |
| Elevation | `--shadow-sm` · `--shadow-md` · `--shadow-lg` |
| Misc | `--overlay` (scrim) · `--sel-amber` (hover tint) · `--{ok,danger,warn,info,violet}-border` |

## Component classes

**Surfaces:** `.card` (primary, r-16) · `.card-sub` (inner, bg-2, r-12) ·
`.card-stat` (stat tile w/ amber bar) · `.card-elevated` · `.card-glass` ·
`.card-header` (header row) · `.section-title` (panel heading) · `.section-label`
(uppercase eyebrow).

**Controls:** `.btn` + `.btn-primary/secondary/danger/ghost/-sm/-xs` ·
`.input` + `.input-label` · `.icon-btn` · `.toggle` · `.segmented` (pill tabs) ·
`.tabs` (underline tabs).

**Data:** `.th/.td/.tr` (tables) · `.list-row` (non-table rows) ·
`.badge` + `-running/online/failed/error/pending/warning/stopped/offline/admin/operator/viewer/info/violet` ·
`.chip` + `-amber/green/slate` · `.stat-number` / `.stat-number-sm` · `.code-block` ·
status dots (`.status-dot status-dot-{green,red,amber,slate}`).

**Overlays:** `.menu` + `.menu-item` (+ `-danger`) · `.modal-backdrop` + `.modal` ·
`.tooltip` · `.kbd` · `.empty-state` (+ `.empty-icon`).

## Migration rules (when bringing a page onto the language)

- Replace ad-hoc cards/menus/modals/badges/segmented controls with the shared class.
- Tokenize neutral/semantic colors; fix `#0F172A` active-surface segmented controls
  with `.segmented` (this is the #1 dark-mode bug).
- Snap off-scale radii/sizes to the nearest scale value **only when it doesn't
  visibly reshape a tuned, dense layout**.
- **Preserve** layout, behavior, the amber brand gradients, the intentionally
  fixed-light Login/Register screens, and everything inside `<svg>` canvases.
