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
