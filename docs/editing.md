# Writing and editing pages

[Documentation index](README.md) · [Noema home](../README.md)

## Create and edit a page

- Create a page using the sidebar **+**. Rename it by editing its title.
- Choose **Add icon** above a page title to pick from 50 Noema line symbols. Search by symbol name or group, click a symbol to autosave, or choose **Reset to default**. Your choice appears in the sidebar, collections, favourites, recent items, and Trash, and follows the app’s light or dark appearance.
- Type `/` at the beginning of a block to choose text, heading, bullet list, quote, or to-do. Use arrow keys and Enter in the menu.
- Press Enter to add a block; Shift+Enter inserts a line break. Hover over a block and click its handle to change its type or delete it.
- Page edits autosave after a short delay. Entity details use **Save details**; property and relationship forms save when submitted. A failed page save stays pending; click the save status to retry.

## Page editing locks

Use **More page actions → Lock editing** in the page toolbar to keep a page readable while preventing changes. Choose **Without a password** in the submenu for a simple editing lock or **With a password…** to require a password when unlocking. Pending edits are saved before locking. Titles, blocks, page sources, featured images, and deletion are protected until editing is unlocked; favourites and reading remain available. Passwords are stored only as salted hashes. Editing locks and their password protection survive app restarts and vault backup/restore.

## Smart quotes

Straight single and double quotes become curly quotes as you type in notes, table cells, and note titles. Opening and closing quotes follow the surrounding text, and contractions use a curly apostrophe. Pasted text, existing content, undo/redo, code, links, and equations retain their literal characters. Entity matching treats straight and curly quotes as equivalent.

## Mathematics

Math delimiters: type or paste `\(x^2\)` (or `$x^2$`) for inline equations. Paste standalone `\[x^2\]` (or `$$x^2$$`) for display equations, including multiline LaTeX. Completing a standalone display equation while typing converts its paragraph into an equation block. Code spans and fenced code retain literal delimiters.

Page and note titles support LaTeX math with `$...$` or `\(...\)` (also `$$...$$` and `\[...\]`, rendered inline). Focus the title to edit its notation; press Enter or leave the field to see the rendered title. Math also renders in page lists, breadcrumbs, search results, and note links. Titles remain plain text in storage and exports.

## Selecting text

Select text across blocks by dragging or Shift-clicking; Shift+Left/Right can extend a selection across block boundaries. In the editor, press **⌘A** (or **Ctrl+A**) once to select the current block, then again to select the document body. Clicking or moving the caret resets this sequence. Cross-block selections support copy, cut, paste, typing, deletion, and the selection formatting toolbar; editor controls are excluded from copied text.

## Reordering blocks

Reorder any block by dragging its gutter handle. A drop line marks the insertion point; release to save the new order. The page scrolls near the viewport edges during dragging. Press Escape or release outside the document to cancel. A short click still opens block options. Keyboard: focus the handle, press Space to pick up, Up/Down (or Home/End) to choose a position, then Space/Enter to drop or Escape to cancel.

## Semantic blocks

Semantic blocks give content a function independently of its formatting: **Question, Definition, Example, Claim, Evidence, Insight, Summary, or Warning**. Open a block’s handle menu → **Semantic function…**, or use `/question`, `/definition`, etc. The function appears as a colored gutter icon and a subtle matching left accent. Hover or focus the block to replace its icon with the drag handle.

Select text in one block and choose **Semantic** on the selection toolbar to tag that block. Select across multiple blocks and choose a function to put them under one semantic parent. Child blocks retain their types, formatting, references, and any individual functions. The parent’s handle moves the group together; its menu changes the function or **Ungroup blocks** preserves the children and removes the parent. Enter and new blocks inside a group continue within that parent. Copy/paste, autosave, reload, and vault backups preserve semantic metadata. Groups are stored as contiguous child blocks sharing `semanticGroup: {id, kind}`; individual tags use `semantic`. No schema migration is needed for existing pages.

## Links between notes

Type `[[` in the editor to choose a note from the current vault, or type/paste `[[Page title]]` directly. Use `[[Page title|Display alias]]` to show a different label. Click a link or focus it and press Enter to open the note. Links resolve by title within the current vault; duplicate titles offer a choice, and missing titles show a message. Link syntax is preserved when saving and copying. Inline code keeps the syntax literal.

The Knowledge panel lists outgoing links from the current draft and backlinks from other saved notes in the same vault. Outgoing links include display aliases and missing destinations. Repeated links are grouped; trashed notes and syntax inside code or formulas are excluded. Links resolve by title, so duplicate titles may appear as multiple outgoing destinations and share backlinks.

## Images

Paste an image into a page or type `/image` in a text block. The block add menu also includes **Image**. PNG, JPEG, GIF, and WebP files up to 20 MB are supported. Each image becomes a block and follows normal page autosave. Click an image, then press Backspace or Delete to remove it, or choose **Delete block** from its gutter menu. A small image icon below the image toggles its caption field; saved captions remain hidden until opened. An inline loading card shows optimization and saving progress.

**Settings → Images → Automatically compress images** defaults to on. Static images are encoded as WebP (or PNG if WebP encoding is unavailable), with the longest side capped at 2,560 pixels; the original is kept when encoding would make the file larger or cannot decode it. GIF, animated PNG, and animated WebP files keep their animation. Turn compression off to upload the original bytes and dimensions. This setting applies to new uploads and is saved in this browser.

Noema stores image files beside the SQLite database in `assets/<vault-id>/images/<uuid>.<extension>`. Image references belong to that vault, and locked vaults block image reads and uploads. Include this `assets/` folder with the database in backups (the default `data/` folder contains both). Automatic cleanup removes images after their last saved reference is removed or their last referencing note is permanently deleted. Notes in Trash retain their images until permanent deletion, including the normal 30-day expiry. Abandoned uploads get a 24-hour grace period before cleanup on startup or the hourly sweep.

## Trash and note recovery

Use the page toolbar’s **Trash** action to move a note out of the workspace. Open **Trash** at the bottom of the sidebar to restore it or delete it permanently. Restoring a note preserves its blocks, source references, favourites, and surviving folder/collection memberships. Permanent deletion requires confirmation and cannot be undone.

Notes expire 30 days after being moved to Trash. The local server removes expired notes on startup, hourly while running, and before API access. If the app is closed, overdue notes are removed the next time its server starts. Trash belongs to each vault and is unavailable while that vault is locked.

## Find and replace in the current page

Choose **More page actions → Find in page**, or press **Ctrl+F / ⌘F** while a page is open, including after using the page toolbar. **The replace chevron**, **Ctrl+H**, or **⌘Option+F** reveals replacement controls. **⌘/Ctrl+Shift+H** also opens Replace. The compact widget opens centered below the workspace toolbar and stays pinned while scrolling without moving the document, with match arrows and a muted inline count at the right edge inside the search field, smoothly revealed only when searching without resizing the field or moving the controls. Case, whole-word and regular-expression toggles stay visible beside the query. Search options uses Noema’s standard menu, with Search in and Match options submenus, optional snippets and search rules. Linked entities use the shared dropdown. Find stays hidden until invoked and opens and closes with short animations that respect reduced-motion preferences. Only matching text receives a soft yellow highlight; the active hit has a slightly stronger tint and a small yellow marker to the left of the gutter. The document remains at full opacity. Navigation scrolls smoothly to the actual wrapped hit when needed and respects reduced-motion preferences. Snippets stay hidden by default. When shown, the active match is highlighted and automatically kept in view within the list. Enter / Shift+Enter and the Previous / Next buttons navigate results. Repeating the active Find or Replace shortcut closes the panel; switching shortcuts changes modes. Escape also closes it and restores the editing selection. Other focused text fields and open dialogs keep their ordinary shortcuts. Reopening Find selects its current query. Switching page or vault resets the query.

Search uses the current unsaved body, including styled text runs, code and table cells. The title, metadata, other pages and source-reader PDFs are outside the scope. Literal matching is the default; case matching, Unicode whole-word boundaries and regular expressions are optional. Linked-entity mode filters only identities annotated in this page by name, alias, type or description, then navigates those annotations even when the displayed wording differs. It cannot rename, merge, retag or replace entities.

Ordinary text replacements inherit the first matched run's formatting. Unaffected fragments keep their formatting and external links retain their URLs. A match touching an entity annotation, equation, citation, wiki link or different link destinations is marked protected and skipped. Wiki links and citations are searched using stored source text, which can differ from their rendered labels. Matches never cross blocks or table cells. Replace all commits one document-history transaction; normal editor Undo / Redo reverses or reapplies it. Query input retains its own native undo behavior.

Regular expressions run in a disposable local worker with a 300 ms deadline; changing the query, editing or closing the panel cancels obsolete work. No AI or network search is involved. Capture replacements support `$1`–`$99`, `$<name>`, `$&` and `$$`. Nonexistent captures remain literal; unmatched existing captures become empty. Other JavaScript replacement tokens remain literal. Zero-width matches are skipped. Patterns are limited to 1,000 characters, page search to 2 million body characters, and results to 2,000 matches. Replace all is disabled when the match limit is reached, so it never quietly operates on a truncated result set. Snippets show a window of at most 30 results around the active match. Highlight-capable browsers show every returned text match; the gutter marker identifies the active match, and optional snippets provide additional context.

Developer validation: `node --import tsx --test test/document-find.test.mjs` and `PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/check-document-find-browser.mjs`. The latter uses a synthetic local fixture, captures desktop/mobile screenshots under `/tmp/noema-find-screenshots`, tests real worker timeout recovery, IME, replacement history, synthetic fixture reload and production-bundle SQLite autosave/reload, and checks that query changes cause zero editable syncs. Build first for the production-bundle check. Playwright is optional tooling installed outside the repository.

### Presentation modes

The page toolbar groups two icon buttons: **Subtle references** toggles between
Standard (a letter over a filled highlight) and Subtle (the same letter over a
dotted underline). The adjacent **Focus mode** button enters or exits Focus;
exiting restores the previous Standard/Subtle choice. Reference emphasis is fixed
to Subtle while Focus is active. Tooltips explain the current state and action;
both controls support Tab and Space/Enter. Focus uses those same
underlines and centres the editable document while hiding navigation, inspectors,
the table of contents and secondary chrome. Editing, selection formatting,
keyboard shortcuts, find, save failures and draft recovery remain available.
The top-right icon controls remain visible in Focus; the collapse icon exits.
There is no separate Exit Focus button; **Escape** restores the previous Standard/Subtle
mode. Menus, dialogs, find and IME composition take priority over exiting Focus.
Opening an entity restores the full workspace before opening its destination.

`noema.appearance.v1.presentationMode` is the single persisted presentation
preference. A valid mode takes precedence over legacy `focusedReading`; otherwise
legacy `true` migrates to Subtle, and false/missing values to Standard. The old
boolean is no longer written. Entity emphasis and workspace visibility are
independent derived traits, leaving room for future combinations.

The source reader and cited-passage viewer share these controls. Subtle replaces
saved source highlight fills with coloured underlines and softens cited-passage
emphasis. Focus centres the source, hides navigation and inspectors, and keeps
reading, passage selection, highlights, bookmarks and reading notes available.
Exiting restores the existing reader and inspector state without reloading text.

Focus persists across reloads and navigation, but its minimal layout only
applies to an unlocked page editor, source reader or cited-passage viewer. Other destinations retain the full interface.
The previous non-Focus mode is retained in session storage for same-tab reloads;
a fresh tab without that history exits to Standard. If storage is unavailable,
choices and restoration work in memory until reload. Hiding chrome never changes
page content, entity associations, saved panel preferences or sidebar expansion.
Panels and navigation stay mounted; their arrangement returns on exit. Reloads
restore the arrangement normally supported by the workspace, rather than adding
a separate persistent layout snapshot.
