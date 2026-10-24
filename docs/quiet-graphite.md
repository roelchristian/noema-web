# Quiet Graphite visual pass — 2026-10-24

## Phase 1: current-main baseline

Base: `9b6fecc340be24467eeec3b90b9f762a19e12ccd`, fetched October 24. Historical critique was checked against current source and actual rendered light/dark desktop captures before CSS changes. Current Knowledge is a flat library, not the historical entity-card grid. The visible issues are sidebar and inspector weight, persistent versus transient state hierarchy, and repeated outlined controls. Editor geometry, open document canvas, semantic annotations, accent choices and preference persistence remain in scope to preserve.

`node --import tsx scripts/capture-quiet-graphite.mjs` captures a disposable synthetic vault, blocking external browser requests. Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` for installed browser tools; `NOEMA_SCREENSHOTS` controls the output directory. Defaults cover 1440/390 px, light/dark, Ink/Juniper/Atlantic and Standard/Subtle/Focus. Focus is captured on editor and reader, then exited through the real Escape interaction to reach navigation/overlays. Every capture records effective root presentation attributes; filenames describe initial preference, not a claim that hidden navigation is available in Focus. Captures wait for Knowledge loading labels to disappear. No real vault, secrets or provider calls are used.

Evidence lives in ignored `output/quiet-graphite/` (baseline and final); manifests record exact captures. Screenshot capture is distinct from visual review; the final record identifies reviewed samples and remaining gaps. Illustrative remote references were not used or claimed reviewed.

Independent review is requested for both code and rendered evidence. Essential input boundaries must remain at least 3:1 against their actual surfaces; decorative button borders can be quieter. Light colors and geometry must remain unchanged. Safari requires separate inspection and is unavailable in this Linux environment.

## Implementation phases

- Phase 1 `c6447d7`: current-main audit and reproducible synthetic screenshot harness.
- Phase 2 `dc4d1f2`: dark-only warm-neutral surfaces, recessive navigation, distinct selection/hover and separate decorative button borders. Navigation hover moved to its layout owner and leaves persistent selection intact.
- Phase 3 `2e9e143`: open content surfaces and consistent editor/Knowledge temporary overlays; source excerpt and document-icon fills recede. No editor toolbar or source metadata behavior changed.
- Phase 4 `8c0dbfc`: consistent Library/Calendar selected controls, flatter calendar table/inspector surfaces, structural dialog and palette-menu borders, elevated calendar popovers.
- Validation follow-up `8b87bc9`: relationship-based assertions for dark hierarchy, plus essential boundary contrast against canvas, raised and popover roles. The essential border was retained at `#777a75` (3.08:1 on the brightest popover); decorative labeled buttons use a quieter independent border.

Accents, all six entity palettes, semantic danger/warning/success/info and liturgical colors are untouched. No appearance setting, storage migration, component rewrite, geometry change or new global override layer was introduced. `knowledge.css`, `sources.css`, `editor.css` overlap the named concurrent efforts, but edits affect existing backgrounds/borders only. The published current-main features were incorporated by starting from and re-fetching main, rather than importing unpublished parallel branches.

Production captures: build the pristine baseline and final checkout separately, then set `NOEMA_CAPTURE_PRODUCTION=1`. This avoids repeated development transforms and makes each capture use one stable built artifact. Authoritative evidence directories are `output/quiet-graphite/production-baseline-1440`, `production-baseline-390`, `production-final-1440`, `production-final-390`. Earlier development captures are exploratory and excluded from final coverage. The historical October 23 report in `dark-mode-redesign.md` remains a historical record; this document records the new rendered pass.

## Main integration

Before final validation, fetched and merged `21aef2a` (Entities/Connections and AI pricing updates) as local merge `da9d27e`. The Settings owner merged cleanly; no parallel hooks or behavior were overwritten. The new Connect picker gets a single dark-only pressed-filter role change in its own `connect-picker.css`, preserving its exact light fill. The capture harness now includes settled properties, the grouped Connections view and the open Connect picker. Integrated validation and screenshots use separately built `21aef2a` baseline and merged final checkouts; earlier images remain explicitly earlier evidence.

Independent review covered the complete visual CSS diff and representative actual desktop/mobile Chromium pairs: editor, Knowledge panel/library, entity properties, Sources/reader, Pages Library, Calendar, Settings, menu/dialog, all three accents and Standard/Subtle/Focus reading samples. It found no blocking code or visual defect. The initial essential-boundary concern was corrected; loading property captures were replaced by settled supplemental images. The later dark-only Connect picker change was independently reviewed without findings. New integrated Connections screenshots remain part of final validation.

The first full suite on the initial base had 1,331 tests: 1,320 passed, four failed, seven skipped under simultaneous browser load. The four failing files (speech transport, Calendar preload, navigation UI, source reprocessing concurrency) then passed all 65 tests when rerun serially. No application behavior or tests were changed to conceal these timing failures. A fresh full suite on integrated main is run with browser workers stopped.
