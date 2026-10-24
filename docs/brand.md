# Quiet Orbit mark

The Noema mark is one interrupted orbital arc with rounded terminals, one hollow
central ring and one solid satellite. Keep it static and monochrome. The wordmark
and functional icons are separate from this mark.

`public/noema-mark.svg` is the single source of geometry. It preserves the selected
1000-unit design's coordinates and 61-unit stroke; a `120 120 760 760` viewport
removes excess outer whitespace for legibility at 16–18px without clipping strokes.
The sidebar uses it as an alpha mask with `currentColor`, inheriting the wordmark's
theme color. Its decorative element is hidden from assistive technology; the link
retains the localized “Noema home” accessible name.

The modern SVG favicon uses the same asset. Its own `prefers-color-scheme` rule
follows browser/system appearance, independently of Noema's saved appearance.
The legacy ICO contains 16/32/48px images with a white backing, so its dark mark
remains visible on either browser theme. Do not hand-edit that generated asset.

Regenerate it with the optional browser tooling (no new app dependencies):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node scripts/generate-brand-assets.mjs
```

Build first, then validate with a synthetic in-memory vault, blocked external
browser requests and disabled providers:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node --import tsx scripts/check-brand-browser.mjs
```

`CHROMIUM_PATH` overrides `/usr/bin/chromium`; `NOEMA_SCREENSHOTS` selects the
evidence directory. The check covers the real sidebar at desktop/mobile widths,
all three accents, both appearance modes, live color changes, accessible naming,
and SVG/ICO pixel legibility at 16px. It captures actual 18px sidebar rendering.
Headless Chromium can validate the favicon resource, not native browser tab chrome;
Safari and other platforms require their own visual checks.
