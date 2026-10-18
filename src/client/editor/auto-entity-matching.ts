/** Leave manual annotation, text selection, menus, and IME composition undisturbed. */
export const ambiguityReviewDelay = 1800;
// History replay must remain stable until the writer starts another edit.
let historyPaused = false;
export function pauseEntityRecognition() { historyPaused = true; }
export function resumeEntityRecognition() { historyPaused = false; }
export function canIdentifyEntities() {
  if (historyPaused) return false;
  if (typeof document === 'undefined') return true;
  if (document.querySelector('.page[data-entity-composing], #blocks[data-block-dragging], .selection-popover, .entity-match-popover, .command-menu, dialog[open]')) return false;
  return document.getSelection()?.isCollapsed !== false;
}

export function yieldForEntityMatching(): Promise<void> {
  return typeof requestAnimationFrame === 'function'
    ? new Promise(resolve => requestAnimationFrame(() => resolve()))
    : Promise.resolve();
}
