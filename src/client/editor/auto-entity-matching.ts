/** Leave manual annotation, text selection, menus, and IME composition undisturbed. */
export function canIdentifyEntities() {
  if (typeof document === 'undefined') return true;
  if (document.querySelector('.page[data-entity-composing], .selection-popover, .command-menu, dialog[open]')) return false;
  return document.getSelection()?.isCollapsed !== false;
}

export function yieldForEntityMatching(): Promise<void> {
  return typeof requestAnimationFrame === 'function'
    ? new Promise(resolve => requestAnimationFrame(() => resolve()))
    : Promise.resolve();
}
