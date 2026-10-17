function length(node: Node): number {
  if(node instanceof HTMLElement && node.dataset.wikilink!==undefined)return node.dataset.wikilink.length;
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\u200b/g, '').length;
  if (node instanceof HTMLElement && node.tagName === 'BR') return 1;
  return [...node.childNodes].reduce((total, child) => total + length(child), 0);
}

/** Keep an idle writer's caret when plain text becomes atomic entity mentions. */
export function replaceEditableHTML(element: HTMLElement, html: string) {
  const selection = document.getSelection();
  const current = selection?.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null;
  let offset: number | null = null;
  if (current && element.contains(current.startContainer)) {
    const prefix = current.cloneRange();
    prefix.selectNodeContents(element); prefix.setEnd(current.startContainer, current.startOffset);
    offset = length(prefix.cloneContents());
  }
  element.innerHTML = html;
  if (offset === null || !selection) return;
  const restored = document.createRange();
  let remaining = offset;
  function place(node: Node): boolean {
    const size = length(node);
    if (node instanceof HTMLElement && (node.dataset.entity || node.dataset.wikilink!==undefined || node.dataset.math !== undefined || node.tagName === 'BR')) {
      if (remaining <= size) {
        if (remaining === 0) restored.setStartBefore(node); else restored.setStartAfter(node);
        return true;
      }
      remaining -= size; return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      if (remaining <= size) {
        const text = node.textContent ?? '';
        let index = 0, logical = 0;
        while (index < text.length && logical < remaining) { if (text[index] !== '\u200b') logical++; index++; }
        restored.setStart(node, index); return true;
      }
      remaining -= size; return false;
    }
    return [...node.childNodes].some(place);
  }
  if (!place(element)) { restored.selectNodeContents(element); restored.collapse(false); }
  restored.collapse(true); selection.removeAllRanges(); selection.addRange(restored);
}
