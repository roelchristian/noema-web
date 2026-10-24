# Quiet Graphite visual pass — 2026-10-24

## Phase 1: current-main baseline

Base: `9b6fecc340be24467eeec3b90b9f762a19e12ccd`, fetched October 24. Historical critique was checked against current source and actual rendered light/dark desktop captures before CSS changes. Current Knowledge is a flat library, not the historical entity-card grid. The visible issues are sidebar and inspector weight, persistent versus transient state hierarchy, and repeated outlined controls. Editor geometry, open document canvas, semantic annotations, accent choices and preference persistence remain in scope to preserve.

`node --import tsx scripts/capture-quiet-graphite.mjs` captures a disposable synthetic vault, blocking external browser requests. Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` for installed browser tools; `NOEMA_SCREENSHOTS` controls the output directory. Defaults cover 1440/390 px, light/dark, Ink/Juniper/Atlantic and Standard/Subtle/Focus. Focus is captured on editor and reader, then exited through the real Escape interaction to reach navigation/overlays. Every capture records effective root presentation attributes; filenames describe initial preference, not a claim that hidden navigation is available in Focus. Captures wait for Knowledge loading labels to disappear. No real vault, secrets or provider calls are used.

Evidence lives in ignored `output/quiet-graphite/` (baseline and final); manifests record exact captures. Screenshot capture is distinct from visual review; the final record identifies reviewed samples and remaining gaps. Illustrative remote references were not used or claimed reviewed.

Independent review is requested for both code and rendered evidence. Essential input boundaries must remain at least 3:1 against their actual surfaces; decorative button borders can be quieter. Light colors and geometry must remain unchanged. Safari requires separate inspection and is unavailable in this Linux environment.
