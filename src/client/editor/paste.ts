import { displayMathSource } from './math-delimiters';
import { safeHref, type Block, type BlockType, type Segment, type TextStyle } from '../../shared/domain';
import { readSegments } from './segments';
export function makeBlock(type: BlockType = 'paragraph', content: Segment[] = []): Block {
  return {id: crypto.randomUUID(), type, checked: false, content, ...(type === 'table' ? {rows: [[[], []], [[], []]]} : {})};
}
export function markdownInline(text: string, style: TextStyle = {}): Segment[] {
  const pattern = /(`+)([\s\S]*?)\1|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?!\$)|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g;
  const output: Segment[] = []; let start = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > start) output.push({...style, text: text.slice(start, match.index)});
    if (match[1]) output.push({...style, code: true, text: match[2]});
    else if (match[10] || match[11] !== undefined) {
      const source = (match[10] ?? match[11])!.trim();
      output.push(source ? {...style, math: true, text: source} : {...style, text: match[0]});
    }
    else if (match[3]) output.push(...markdownInline(match[3], {...style, ...(safeHref(match[4]!) ? {href: safeHref(match[4]!)} : {})}));
    else output.push(...markdownInline((match[5] ?? match[6] ?? match[7] ?? match[8] ?? match[9])!, {...style, ...(match[5] || match[6] ? {bold: true} : match[7] ? {strike: true} : {italic: true})}));
    start = match.index! + match[0].length;
  }
  if (start < text.length) output.push({...style, text: text.slice(start)});
  return output;
}
function tableCells(line: string) { return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => markdownInline(cell.trim().replace(/\\\|/g, '|'))); }
export function markdownBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (line.trim().startsWith('\\[')) {
      let end = i;
      while (end < lines.length && !lines[end]!.trim().endsWith('\\]')) end++;
      const source = end < lines.length ? displayMathSource(lines.slice(i, end + 1).join('\n')) : undefined;
      if (source) { blocks.push(makeBlock('math', [{text: source}])); i = end; continue; }
    }
    if (line.trim().startsWith('$$')) {
      const first = line.trim().slice(2);
      if (first.endsWith('$$') && first.length > 2) {
        blocks.push(makeBlock('math', [{text: first.slice(0, -2).trim()}])); continue;
      }
      let end = i + 1;
      while (end < lines.length && lines[end]!.trim() !== '$$') end++;
      if (end < lines.length) {
        blocks.push(makeBlock('math', [{text: [first, ...lines.slice(i + 1, end)].join('\n').trim()}])); i = end; continue;
      }
    }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 1] ?? '')) {
      const rows = [tableCells(line)]; i++;
      while (i + 1 < lines.length && lines[i + 1]!.includes('|') && lines[i + 1]!.trim()) rows.push(tableCells(lines[++i]!));
      const width = Math.min(20, Math.max(...rows.map(row => row.length)));
      blocks.push({...makeBlock('table'), rows: rows.slice(0,100).map(row => Array.from({length: width}, (_, col) => row[col] ?? []))}); continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      const fence = line.trim().slice(0,3), content: string[] = [];
      while (++i < lines.length && !lines[i]!.trim().startsWith(fence)) content.push(lines[i]!);
      blocks.push(makeBlock('paragraph', [{text: content.join('\n'), code: true}])); continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/), todo = line.match(/^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/), bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/), quote = line.match(/^\s*>\s?(.*)$/);
    const block = heading ? makeBlock(heading[1]!.length === 1 ? 'heading1' : 'heading2', markdownInline(heading[2]!)) : todo ? {...makeBlock('todo', markdownInline(todo[2]!)), checked: todo[1]!.toLowerCase() === 'x'} : bullet ? makeBlock('bullet', markdownInline(bullet[1]!)) : quote ? makeBlock('quote', markdownInline(quote[1]!)) : makeBlock('paragraph', markdownInline(line));
    if (!heading && !todo && !bullet && !quote) {
      while (i + 1 < lines.length && lines[i + 1]!.trim() && !/^\s*(?:\$\$|\\\[|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~)/.test(lines[i + 1]!) && !(lines[i + 1]!.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 2] ?? ''))) {
        block.content.push({text: '\n'}, ...markdownInline(lines[++i]!));
      }
    }
    blocks.push(block);
  }
  return blocks.length ? blocks : [makeBlock('paragraph', text ? [{text}] : [])];
}
export function clipboardBlocks(text: string, html: string): Block[] {
  if (!html) return markdownBlocks(text);
  const doc = new DOMParser().parseFromString(html, 'text/html'), blocks: Block[] = [];
  doc.querySelectorAll('script,style,meta,link,iframe,object').forEach(node => node.remove());
  function visit(parent: Element) {
    let inline = document.createElement('div');
    const flush = () => { if (inline.textContent?.trim() || inline.querySelector('br')) blocks.push(makeBlock('paragraph', readSegments(inline, false))); inline = document.createElement('div'); };
    for (const node of Array.from(parent.childNodes)) {
      if (!(node instanceof HTMLElement)) { inline.append(node.cloneNode(true)); continue; }
      const tag = node.tagName;
      if (tag === 'TABLE') {
        flush(); const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node).slice(0,100).map(row => Array.from(row.cells).slice(0,20).map(cell => readSegments(cell, false)));
        const width = Math.max(0,...rows.map(row => row.length));
        if (width) blocks.push({...makeBlock('table'), rows: rows.map(row => Array.from({length: width}, (_, i) => row[i] ?? []))});
      } else if (['UL','OL'].includes(tag)) { flush(); visit(node); }
      else if (['P','DIV','SECTION','ARTICLE','MAIN','BLOCKQUOTE','H1','H2','H3','H4','H5','H6','LI','PRE'].includes(tag)) {
        flush();
        if (tag !== 'LI' && node.querySelector('p,div,table,ul,ol,h1,h2,blockquote')) visit(node);
        else {
          const copy = node.cloneNode(true) as HTMLElement; copy.querySelectorAll('ul,ol').forEach(list => list.remove());
          const checkbox = copy.querySelector<HTMLInputElement>('input[type=checkbox]');
          const type: BlockType = tag === 'H1' ? 'heading1' : /^H[2-6]$/.test(tag) ? 'heading2' : tag === 'LI' ? checkbox ? 'todo' : 'bullet' : tag === 'BLOCKQUOTE' ? 'quote' : 'paragraph';
          blocks.push({...makeBlock(type, tag === 'PRE' ? [{text: node.textContent || '', code: true}] : readSegments(copy, false)), checked: checkbox?.checked ?? false});
          if (tag === 'LI') node.querySelectorAll(':scope > ul,:scope > ol').forEach(visit);
        }
      } else inline.append(node.cloneNode(true));
    }
    flush();
  }
  visit(doc.body);
  // Some applications wrap plain Markdown in one styled span.
  return blocks.length ? blocks : markdownBlocks(text);
}
