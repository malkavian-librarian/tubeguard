# TubeGuard Brand Book — Night-Mode Purple-Neon

The durable design-system reference for TubeGuard. Every color, spacing, radius, and
typography value used anywhere in the extension — popup, stats page, options page,
and the UI injected into YouTube — comes from a single token file:
**`src/shared/theme.css`**. Night-mode only. There is no light-mode branch and no
`prefers-color-scheme` fallback anywhere in the codebase.

Shared component classes for the content-script UI (block button, stats chip,
confirm popover, undo toast) live in **`src/content/injected-ui.css`**, injected onto
YouTube pages by `src/content/theme-inject.js` alongside `theme.css`.

---

## 1. Palette

### Surfaces

| Token | Value | Usage |
|---|---|---|
| `--tg-bg` | `#0d0a14` | Page background (stats, options), YouTube overlay backdrop base |
| `--tg-bg-elevated` | `#150f22` | Reserved for a second background layer above `--tg-bg` (e.g. modals over a page) |
| `--tg-surface` | `#1b1428` | Cards, sections, header bars, popup body panels |
| `--tg-surface-2` | `#241a35` | Inputs, table hover rows, secondary buttons, chip/badge backgrounds |
| `--tg-border` | `#34264d` | Default hairline borders, dividers |
| `--tg-border-strong` | `#4a3570` | Emphasized borders (popover, toast, focus containers) |

### Text

| Token | Value | Usage |
|---|---|---|
| `--tg-text` | `#f3eefc` | Primary body/heading text |
| `--tg-text-secondary` | `#b6a8d1` | Labels, captions, secondary copy |
| `--tg-text-muted` | `#8577a3` | Disabled/placeholder-level text |
| `--tg-text-on-accent` | `#ffffff` | Text/icons placed on a solid `--tg-accent` or `--tg-danger` fill |

### Neon-purple accent system

| Token | Value | Usage |
|---|---|---|
| `--tg-accent` | `#7c3aed` | Primary brand hue. Solid fills (buttons, active tab underline, toggle-on), non-text/decorative use. **Not for normal-size text on `--tg-bg`** — see contrast table. |
| `--tg-accent-strong` | `#9257ff` | Accent used *as text* on `--tg-bg` (headings, links, active-tab label) — passes AA for normal text. |
| `--tg-accent-soft` | `#c9b8ff` | Lightest accent tint — used for text on dark accent-tinted backgrounds (playlist badge, popover links). |
| `--tg-accent-bg` | `rgba(124,58,237,.16)` | Accent tint background (playlist type-badge, status banner in options). |
| `--tg-accent-rgb` | `124, 58, 237` | Raw RGB triplet for building custom `rgba()` glows. |

Glow shadows (used for the "neon" feel — hover states, focus, active toggles, the
injected popover/toast border glow):

| Token | Value | Usage |
|---|---|---|
| `--tg-accent-glow-sm` | `0 0 6px rgba(124,58,237,.55)` | Small hover/active glow (toggle, search focus, secondary buttons) |
| `--tg-accent-glow-md` | `0 0 16px rgba(124,58,237,.55), 0 0 4px rgba(124,58,237,.85)` | Injected block-button hover glow |
| `--tg-accent-glow-lg` | `0 0 32px rgba(124,58,237,.45), 0 0 8px rgba(124,58,237,.75)` | Reserved for large emphasis surfaces |
| `--tg-accent-text-glow` | `0 0 8px rgba(124,58,237,.9)` | `text-shadow` on brand headings (popup `h1`, stats `h1`, options `h1`) |

### Semantic colors

Shifted out of generic red/green/amber into hues that sit near the purple accent on
the wheel — magenta-red for danger, warm amber for warning, teal for success (cooler
than a generic green, harmonizes with the purple/cyan family), and cyan for info.

| Token | Value | Usage |
|---|---|---|
| `--tg-danger` | `#ff4d6d` | Block/delete/danger actions, unsubscribe overlay, channel type-badge text |
| `--tg-danger-bg` | `rgba(255,77,109,.16)` | Channel type-badge background |
| `--tg-warning` | `#ffa94d` | Warning banners, comment type-badge text |
| `--tg-warning-bg` | `rgba(255,169,77,.16)` | Comment type-badge background |
| `--tg-success` | `#3ddc97` | Success/confirmation state (reserved — no current usage site) |
| `--tg-success-bg` | `rgba(61,220,151,.16)` | Success tint background (reserved) |
| `--tg-info` | `#22d3ee` | Video type-badge text |
| `--tg-info-bg` | `rgba(34,211,238,.16)` | Video type-badge background |

---

## 2. Typography

Single system font stack — no external fonts (Google Fonts or otherwise), per the
project's no-external-CDN rule.

| Token | Value |
|---|---|
| `--tg-font` | `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` |
| `--tg-font-mono` | `ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace` |

### Type scale (in use across the extension)

| Context | Size | Weight | Color token |
|---|---|---|---|
| Options `h1` | `clamp(32px,5vw,52px)` | 600 | `--tg-text` (+ accent text-glow) |
| Stats/options `h2` | `28px` | 500 | `--tg-text` |
| Stats card value | `32px` | 700 | `--tg-accent-strong` |
| Popup/stats `h1` | `16–18px` | 700 | `--tg-accent-strong` (+ accent text-glow) |
| Body / table text | `13–14px` | 400–500 | `--tg-text` |
| Labels / eyebrows | `10–12px` | 500–600, uppercase | `--tg-text-secondary` / `--tg-accent-soft` |

---

## 3. Spacing scale (6 steps)

| Token | Value |
|---|---|
| `--tg-space-1` | `4px` |
| `--tg-space-2` | `8px` |
| `--tg-space-3` | `12px` |
| `--tg-space-4` | `16px` |
| `--tg-space-5` | `24px` |
| `--tg-space-6` | `32px` |

## 4. Radius scale (4 steps)

| Token | Value | Usage |
|---|---|---|
| `--tg-radius-sm` | `4px` | Inputs, small buttons, badges |
| `--tg-radius-md` | `8px` | Cards, sections, popover, toast |
| `--tg-radius-lg` | `12px` | Options-page sections |
| `--tg-radius-full` | `999px` | Pills — range buttons, search input, toggle track |

## 5. Elevation

| Token | Value | Usage |
|---|---|---|
| `--tg-shadow-sm` | `0 1px 4px rgba(0,0,0,.45)` | Cards, sticky headers |
| `--tg-shadow-md` | `0 4px 16px rgba(0,0,0,.5)` | Reserved for mid-elevation surfaces |
| `--tg-shadow-lg` | `0 8px 32px rgba(0,0,0,.6)` | Injected popover / toast (paired with `--tg-accent-glow-sm`) |

---

## 6. Components

### `.tg-btn` (injected YouTube UI button)

Base: `--tg-accent` fill, `--tg-text-on-accent` text, `--tg-radius-sm`, bold 12px
label, `--tg-accent-glow-md` on hover.

- `.tg-btn--danger` — `--tg-danger` fill (used by the BLOCK button and the
  channel-blocked overlay's "Unblock Channel" button).
- `.tg-btn--ghost` — `--tg-surface-2` fill, `--tg-border` outline (secondary action).

### `.tg-chip` (stats chip on injected block button)

`--tg-accent-bg` fill, `--tg-accent-soft` text, `--tg-border-strong` outline,
`--tg-radius-sm`. Hidden (`display:none`) until populated; `.tg-chip--visible` toggles
it to `inline-flex` once a channel has watch-time stats.

### `.tg-popover` (block-confirmation popover)

`--tg-surface` fill, `--tg-border-strong` outline, `--tg-radius-md`,
`--tg-shadow-lg` + `--tg-accent-glow-sm`. Contains `.tg-popover__title` and
`.tg-popover__actions` with `.tg-popover__btn--confirm` (`--tg-danger`) /
`.tg-popover__btn--cancel` (`--tg-surface-2`).

### `.tg-toast` (undo toast)

Same surface/border/shadow treatment as the popover. `.tg-toast__undo` is a
text-only accent-soft action button.

### `.tg-overlay` (blocked-channel full-page overlay)

Fixed full-viewport scrim (`rgba(13,10,20,.92)`) with a `.tg-overlay__message`
(accent text-glow) and a `.tg-btn.tg-btn--danger.tg-overlay__btn`.

---

## 7. Accessibility — contrast table

Computed with the WCAG 2.1 relative-luminance formula. AA requires **4.5:1** for
normal text and **3:1** for large text (≥18.66px bold / ≥24px regular) or
non-text UI components.

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `--tg-text` (`#f3eefc`) | `--tg-bg` (`#0d0a14`) | **17.23:1** | AA/AAA pass, all text sizes |
| `--tg-text` | `--tg-surface` (`#1b1428`) | **15.67:1** | AA/AAA pass |
| `--tg-text` | `--tg-surface-2` (`#241a35`) | **14.48:1** | AA/AAA pass |
| `--tg-text-secondary` (`#b6a8d1`) | `--tg-bg` | **8.88:1** | AA/AAA pass |
| `--tg-text-secondary` | `--tg-surface` | **8.08:1** | AA/AAA pass |
| `--tg-text-muted` (`#8577a3`) | `--tg-bg` | **4.82:1** | AA pass, normal text |
| `--tg-accent-soft` (`#c9b8ff`) | `--tg-bg` | **11.01:1** | AA/AAA pass |
| `--tg-accent-strong` (`#9257ff`) | `--tg-bg` | **4.70:1** | AA pass, normal text — use this (not `--tg-accent`) for accent-colored text on `--tg-bg` |
| `--tg-accent` (`#7c3aed`) | `--tg-bg` | **3.44:1** | Fails AA for normal text; passes 3:1 for large text / non-text UI (borders, active-tab underline, toggle fill) only |
| `--tg-text-on-accent` (`#fff`) | `--tg-accent` | **5.70:1** | AA pass, normal text — safe for button labels on `--tg-accent` fill |
| `--tg-text-on-accent` (`#fff`) | `--tg-accent-strong` | **4.18:1** | Fails AA for normal text; passes for large text only — buttons using `--tg-accent-strong` as fill should use large/bold labels or fall back to `--tg-accent` as the fill |
| `--tg-danger` (`#ff4d6d`) | `--tg-bg` | **6.10:1** | AA/AAA (large) pass, normal text |
| `--tg-warning` (`#ffa94d`) | `--tg-bg` | **10.31:1** | AA/AAA pass |
| `--tg-success` (`#3ddc97`) | `--tg-bg` | **11.10:1** | AA/AAA pass |
| `--tg-info` (`#22d3ee`) | `--tg-bg` | **10.85:1** | AA/AAA pass |
| `--tg-bg` (`#0d0a14`) | `--tg-danger` | **6.10:1** | AA pass — dark text/icons on a solid danger fill |
| `--tg-bg` | `--tg-warning` | **10.31:1** | AA/AAA pass |
| `--tg-bg` | `--tg-success` | **11.10:1** | AA/AAA pass |
| `--tg-bg` | `--tg-info` | **10.85:1** | AA/AAA pass |

**Non-text elements** (borders, dividers) are exempt from the 4.5:1 text
requirement; WCAG only asks for 3:1 on borders that are the *sole* indicator of
a control boundary. `--tg-border` against `--tg-bg` is 1.43:1 — this is
intentional (a quiet hairline divider, never the only affordance for an
interactive control; all inputs/buttons also carry a background or label).

**Where a token combination in this table shows "large text only,"** the
component using it must either render at large/bold size or rely on a
non-text cue in addition to color — this is already true for every current
usage site (`--tg-accent` is only used as a fill/border/underline, never as
small text; `--tg-accent-strong` fills are only used behind bold ≥14px labels).

---

## 8. Rules

- All colors, spacing, radius, and typography values come from
  `src/shared/theme.css` custom properties. Never hardcode a hex or px value
  in a `.css` file, or set a cosmetic color/font via inline `element.style`.
- Inline styles remain permitted only for computed layout values that must be
  set at runtime from live geometry (e.g. a popover's `top`/`left` computed
  from `getBoundingClientRect()`). They must never carry a color, font, or a
  static/non-computed layout value that a `.tg-*` class could express.
- Night-mode only. Do not add a `prefers-color-scheme: light` branch or a
  `color-scheme: light` override anywhere in this codebase.
- New injected-YouTube-UI components should reuse or extend the `.tg-btn`,
  `.tg-chip`, `.tg-popover`, `.tg-toast` classes in
  `src/content/injected-ui.css` rather than inventing new inline styles.
