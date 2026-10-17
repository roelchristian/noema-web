const escaped = (text: string, index: number) => {
  let slashes = 0;
  while (index > 0 && text[--index] === '\\') slashes++;
  return slashes % 2 === 1;
};

function literalContext(text: string) {
  let ticks = '', dollars = '', latex = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (escaped(text, index)) continue;
    if (char === '`') {
      const run = text.slice(index).match(/^`+/)![0];
      if (!ticks) ticks = run; else if (ticks === run) ticks = '';
      index += run.length - 1; continue;
    }
    if (ticks) continue;
    if (char === '$') {
      const run = text[index + 1] === '$' ? '$$' : '$';
      if (!dollars) dollars = run; else if (dollars === run) dollars = '';
      index += run.length - 1;
    }
    if (char === '\\' && ['(', '['].includes(text[index + 1] || '')) latex = text[index + 1]!;
    if (char === '\\' && ((latex === '(' && text[index + 1] === ')') || (latex === '[' && text[index + 1] === ']'))) latex = '';
  }
  return !!(ticks || dollars || latex);
}

/** Only the newly typed characters change; paste, undo, and composition stay literal. */
export function smartenTypedQuotes(text: string, caret: number, data: string | null, inputType: string, composing = false) {
  if (composing || inputType !== 'insertText' || !data || !/["']/.test(data)) return text;
  const start = caret - data.length;
  if (start < 0 || text.slice(start, caret) !== data) return text;
  let result = text;
  for (let index = start; index < caret; index++) {
    const char = result[index];
    if ((char !== '"' && char !== "'") || escaped(result, index) || literalContext(result.slice(0, index))) continue;
    const previous = result.slice(0, index).replace(/\u200b/g, '').at(-1) || '';
    const opening = !previous || /[\s([{<—–/:;=]/u.test(previous) || (char === "'" && previous === '“') || (char === '"' && previous === '‘');
    const quote = char === '"' ? opening ? '“' : '”' : opening ? '‘' : '’';
    result = result.slice(0, index) + quote + result.slice(index + 1);
  }
  return result;
}

export function applySmartQuotes(element: HTMLElement, event: InputEvent) {
  if (event.isComposing || event.inputType !== 'insertText' || !event.data || !/["']/.test(event.data)) return;
  const selection = document.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0), node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !element.contains(node) || node.parentElement?.closest('code,a,[data-math],[data-entity]')) return;
  const offset = range.startOffset, start = offset - event.data.length;
  if (start < 0 || node.textContent?.slice(start, offset) !== event.data) return;
  const prefix = range.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(node, offset);
  const text = prefix.toString();
  const converted = smartenTypedQuotes(text, text.length, event.data, event.inputType);
  if (converted === text) return;
  (node as Text).replaceData(start, event.data.length, converted.slice(-event.data.length));
  range.setStart(node, offset); range.collapse(true);
  selection.removeAllRanges(); selection.addRange(range);
}

export function smartQuoteTitle(input: HTMLInputElement, event: InputEvent) {
  const caret = input.selectionStart;
  if (caret === null) return input.value;
  const text = smartenTypedQuotes(input.value, caret, event.data, event.inputType, event.isComposing);
  if (text !== input.value) {
    const end = input.selectionEnd;
    input.value = text; input.setSelectionRange(caret, end ?? caret);
  }
  return text;
}
