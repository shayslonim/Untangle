# Design notes

## Direction
Calm "care journal," not a clinical dashboard. The emotional job: make logging
feel safe and un-shaming so the user actually does it, and make calm days feel
like wins rather than blank space.

## Palette (pastel)
| token | hex | use |
|---|---|---|
| paper | `#F7F4F0` | app background |
| ink | `#413B4E` | primary text |
| ink-soft | `#7A7488` | secondary text |
| line | `#EAE4DD` | borders/dividers |
| periwinkle | `#AEB6EC` | site tags, default entry accent |
| sage | `#AFD8C4` | "automatic" mode, calm/zero-day leaf |
| blush | `#F1C4CF` | "focused" mode, trigger tags |
| butter | `#F3E3B0` | notices / non-alarm banners |
| lilac | `#8B82D8` | primary actions |
| lilac-deep | `#6F66C4` | hover/active, chart values |

Deliberately **no alarm-red**. High counts are never punished by color.

## Type
- **Fraunces** (soft humanist serif) — the hero count and headings. Carries the
  gentle personality; used with restraint.
- **Nunito Sans** — UI and body; rounded, quiet, pairs with the pastels.

## Signature elements
- Weekly/monthly charts drawn as **soft rounded "hills"** (hand-coded SVG).
- **Zero-days render a sage leaf** instead of a bar → calm reads as a win.
- Hero count turns sage at 0 with encouraging microcopy.

## Layout
- Mobile-first; content column maxes at 640px.
- Bottom tab bar (Today / Trends) on phones; top nav ≥720px.
- Oversized primary button for thumb reach; large touch targets throughout.

## Accessibility floor
Visible focus rings, `prefers-reduced-motion` honored, semantic buttons with
`aria-pressed` on chips, sufficient contrast for text on pastel surfaces.

## Copy rules
Sentence case, warm, plain verbs, never scolding. Empty states invite action
("Tap the button whenever you notice a pull — or an urge you resisted").
