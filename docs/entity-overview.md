# Entity Overview

The entity homepage keeps Overview, Connections, Mentions, Sources, Discovery,
and Edit. Overview is a reading surface: it does not generate AI output, enrich
records, synchronize the source index, or change page associations. Page
attachment, pinning, annotations, removal, and creation now live in Mentions;
their existing APIs and behavior are retained. Authored Markdown and its draft,
conflict, preview, and save workflow remain in Overview.

## Composition and deterministic selection

- Identity uses the recorded description, shortened to 360 characters. The
  header retains the actual name, type, subtypes, domains, and archived state.
  Missing descriptions get an Edit gateway, never an inferred biography.
- Properties show at most four recorded values. Existing type-template
  priorities come first (for example birth date or event start date), followed
  by name and ID. The bounded server candidate set prioritizes builtin fields
  before custom fields. Values and names are shortened for display; Edit has
  the complete values and temporal precision is retained for date fields.
- Connected entities show at most four distinct accessible target identities:
  typed relationships first, outgoing property references next, incoming
  property references last. Within each server list, label/name then ID is
  deterministic. The first relation to each identity supplies its direction
  and label; Connections retains all the distinct edges. Archived targets are
  labelled. Missing targets are omitted from this preview, not invented.
- Associated pages show at most three distinct page IDs: pinned first, then
  association `created_at` descending, then ID. That timestamp records the
  original attachment, persists through pin/annotation edits, and is not
  claimed to measure subsequent association activity. An annotation is shown
  as user-recorded context, not as an extracted page quotation.
- Page mentions are a separate list of at most two pages, ordered by page
  `updated_at` descending then ID, explicitly called **recently edited** pages.
  This is not mention/association recency. The first saved occurrence context
  supplies the literal excerpt, heading path, and exact occurrence reference.
  Missing occurrence callbacks fall back to the actual page. A page may occur
  in both lists because association and inline mention are different facts.
- Source previews show at most two source identities, one actual passage per
  source. Within the bounded candidate window, currently navigable passages
  precede stale ones; provenance priority is same-run citation, associated
  reading note, matching highlight, then literal entity-name match. Source ID
  and passage ID break ties. This ordering describes provenance and
  navigability, not truth, importance, or support for an entity description.
  Each excerpt keeps its reason(s), source title, available heading, locator,
  and original reference. Display shortening never changes navigation
  coordinates or the reference excerpt. Duplicate coordinates merge reasons
  and page origins on the server; duplicate source IDs share one preview.
- Aliases retain saved order, with at most five displayed and an Edit gateway
  to the complete list.
- Discovery is an explicit gateway with suggestions distinguished from saved
  relationships and evidence. Opening Overview never opens/generates Discovery.

All previews render text through React escaping. Existing safe Markdown
rendering is retained for authored notes. Source excerpts may be associated
through a citation or reading note without asserting that they substantiate
any description, relationship, or claim. Historical/unverified coordinates
retain the existing stale-reference viewer behavior; unavailable or unadmitted
files are excluded. Archived sources remain historical citation evidence when
available, not active name-search discoveries.

## Bounds and navigation

`GET /api/entities/:id?preview=1` returns up to 12 properties, 12 relationships,
12 incoming properties, 12 associated page summaries, and six mentioned pages.
Only those six candidate page bodies are projected for mention contexts; each
preview retains one context/occurrence while the detailed request retains all.
The `previewLimited` flag means a candidate window, not an exact total, so the
header uses destinations instead of misleading sampled counts. Opening
Connections, Mentions, or Edit loads the existing full detail response before
showing editable/detailed content. Failed loads can be retried; late responses
from another identity are ignored.

`GET /api/entities/:id/evidence?preview=1` examines at most 12 candidate pages,
24 highlight candidates, 24 indexed passage candidates, and 32 literal names.
It returns up to six distinct source identities for the client's two-source
selection. One lookahead record detects each scan cap. It reads the existing
source index without synchronization; Sources retains its existing deeper,
paginated discovery behavior. Thus a preview may omit useful evidence, and an
empty preview does not assert that no evidence exists. Source validation reads
only files referenced by bounded candidates. No whole neighborhood is requested.

Tab selection and per-tab document scroll positions are saved in this browser
history entry, namespaced by vault/entity ID, without evidence contents. Tab
buttons use the existing ARIA tab pattern, arrow/Home/End keyboard navigation,
and focus without scrolling. Deferred source loading restores the remembered
position after content is ready; opening a passage retains its trigger for
focus return. Native workspace URLs and back/forward navigation remain intact.
Source requests abort when interrupted and ignore late results. Existing
previews remain visible while refreshing the same identity to avoid collapse.

On this main branch, Date is not an `EntityType`: dates use Calendar and temporal
properties. Source identities route to their existing reader. This change
preserves both routes, adds no Date schema, and verifies event/person date
precision and the native Source route. Direct rendering of EntityHome for a
Source still uses recorded type/description/properties rather than invented
identity text; source curation restrictions remain server-owned.

## Verification

Use `npm run build` (styles and application/test typechecks), `npm run test:all`,
and the existing browser tooling:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node --import tsx scripts/check-entity-overview-browser.mjs
```

The dedicated browser flow uses only a disposable synthetic vault and local
HTTP server. It covers six tabs and gateways, bounded rich previews, sparse
identity, temporal precision, Source routing, exact mention/source navigation,
source-trigger focus return, keyboard tabs, desktop/mobile screenshots, mobile
overflow and 44px controls, native back/forward and scroll restoration, retry,
interrupted loading, and stale archived source evidence. It records console
errors, external requests, and entity writes; each must be empty. The artifact
directory defaults to `/workspace/entity-overview-evidence` and can be set with
`NOEMA_SCREENSHOTS`. No real vault or configured AI provider is used.
