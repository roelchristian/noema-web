import { inlineMathAtCaret } from './math-delimiters';
import katex from 'katex';

export function renderMath(source: string, displayMode = false) {
  return katex.renderToString(source, {displayMode, throwOnError: false, trust: false, strict: 'ignore', maxSize: 20, maxExpand: 1000});
}
export function mathElement(source: string) {
  const el = document.createElement('span');
  el.className = 'inline-math'; el.dataset.math = source; el.contentEditable = 'false';
  el.setAttribute('role', 'button'); el.tabIndex = 0;
  el.setAttribute('aria-label', `Edit equation: ${source}`);
  el.title = 'Edit equation'; el.innerHTML = renderMath(source);
  return el;
}
/** Replace a completed $…$ or \(...\) expression immediately before the caret. */
export function completeInlineMath(el: HTMLElement) {
  const selection = getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return;
  const range = selection.getRangeAt(0), node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !el.contains(node) || node.parentElement?.closest('code,[data-math]')) return;
  const before = node.textContent!.slice(0, range.startOffset);
  const match = inlineMathAtCaret(before);
  if (!match) return;
  const replacement = range.cloneRange(); replacement.setStart(node, match.index!);
  replacement.deleteContents(); const math = mathElement(match.source); replacement.insertNode(math);
  const spacer = document.createTextNode('\u200b'); math.after(spacer);
  replacement.setStart(spacer, 1); replacement.collapse(true);
  selection.removeAllRanges(); selection.addRange(replacement);
}
