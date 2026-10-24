import {randomUUID} from '../../shared/uuid';
import { isSemanticKind, normalizeSemanticGroups } from '../../shared/semantic-blocks';
import { displayMathSource } from './math-delimiters';
import { safeHref, type Block, type BlockType, type Segment, type TextStyle } from '../../shared/domain';
import { readSegments } from './segments';
import { inlineCodeSegments } from './inline-code';
import { readMarkdownTyping } from '../state/markdown-preferences';
export function makeBlock(type: BlockType = 'paragraph', content: Segment[] = []): Block {
  return {id: randomUUID(), type, checked: false, content, ...(type === 'columns' ? {rows: [[[], []]]} : type === 'table' ? {rows: [[[], []], [[], []]]} : {})};
}
export function markdownInline(text: string, style: TextStyle = {}): Segment[] {
  const pattern = /\[\[[^\]\n]+\]\]|(`+)([\s\S]*?)\1|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?!\$)|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g;
  const output: Segment[] = []; let start = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > start) output.push({...style, text: text.slice(start, match.index)});
    if (match[0].startsWith('[[')) output.push({...style,text:match[0],skipAutoTag:true});
    else if (match[1]) output.push({...style, code: true, text: match[2]});
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
/** Preserve native marks and protected segments while reading literal inline Markdown. */
export function markdownSegments(content:Segment[]):Segment[] {
  return inlineCodeSegments(content).flatMap(segment=>{
    if(segment.entityId||segment.code||segment.math||segment.sourceReference||segment.bibliographicReference||segment.href||segment.skipAutoTag)return [segment];
    const {text,...style}=segment;
    return markdownInline(text??'',style);
  });
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
      blocks.push(makeBlock('code', [{text: content.join('\n')}])); continue;
    }
    if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) { blocks.push(makeBlock('divider')); continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/), todo = line.match(/^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/), bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/), quote = line.match(/^\s*>\s?(.*)$/);
    const block = heading ? makeBlock(heading[1]!.length === 1 ? 'heading1' : 'heading2', markdownInline(heading[2]!)) : todo ? {...makeBlock('todo', markdownInline(todo[2]!)), checked: todo[1]!.toLowerCase() === 'x'} : bullet ? makeBlock(/^\s*\d/.test(line) ? 'numbered' : 'bullet', markdownInline(bullet[1]!)) : quote ? makeBlock('quote', markdownInline(quote[1]!)) : makeBlock('paragraph', markdownInline(line));
    if (!heading && !todo && !bullet && !quote) {
      while (i + 1 < lines.length && lines[i + 1]!.trim() && !/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(lines[i + 1]!) && !/^\s*(?:\$\$|\\\[|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~)/.test(lines[i + 1]!) && !(lines[i + 1]!.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 2] ?? ''))) {
        block.content.push({text: '\n'}, ...markdownInline(lines[++i]!));
      }
    }
    blocks.push(block);
  }
  return blocks.length ? blocks : [makeBlock('paragraph', text ? [{text}] : [])];
}
/** Read code and math in rich clipboard text while preserving existing formatting. */
export function clipboardMathBlocks(blocks: Block[]): Block[] {
  function slice(content: Segment[], start: number, end: number): Segment[] {
    let offset = 0;
    return content.flatMap(segment => {
      const value = segment.text ?? '', from = Math.max(0, start - offset), to = Math.min(value.length, end - offset);
      offset += value.length;
      return to > from ? [{...segment, text: value.slice(from, to)} as Segment] : [];
    });
  }
  function inline(content: Segment[]): Segment[] {
    content=markdownSegments(content);
    const output: Segment[] = [];
    for (let i = 0; i < content.length;) {
      const segment = content[i]!;
      if (segment.entityId || segment.code || segment.math || segment.sourceReference||segment.bibliographicReference || segment.href) { output.push(segment); i++; continue; }
      const run: Segment[] = [];
      while (i < content.length && !content[i]!.entityId && !content[i]!.code && !content[i]!.math && !content[i]!.sourceReference&&!content[i]!.bibliographicReference && !content[i]!.href) run.push(content[i++]!);
      const text = run.map(s => s.text).join(''); let start = 0;
      // Backtick spans protect literal math in Markdown wrapped by a clipboard span.
      const pattern = /(`+)[\s\S]*?\1|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?!\$)/g;
      for (const match of text.matchAll(pattern)) {
        const source = (match[2] ?? match[3])?.trim();
        if (!source) continue;
        output.push(...slice(run, start, match.index!), {text: source, math: true});
        start = match.index! + match[0].length;
      }
      output.push(...slice(run, start, text.length));
    }
    return output;
  }
  const plain = (block: Block) => block.type === 'paragraph' && block.content.every(s => !s.entityId && !s.code && !s.math && !s.sourceReference&&!s.bibliographicReference && !s.href);
  const output: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.type === 'table' || block.type === 'columns') { output.push({...block, rows: block.rows?.map(row => row.map(inline))}); continue; }
    if (block.type === 'code' || block.type === 'divider' || block.type === 'math' || block.type === 'image') { output.push(block); continue; }
    if (!plain(block)) { output.push({...block, content: inline(block.content)}); continue; }
    let content = block.content, text = content.map(s => s.text).join('');
    // Browsers may put each line of a display equation in a separate paragraph.
    if (/(?<!\\)\\\[/.test(text) && !/(?<!\\)\\\]/.test(text)) {
      let end = i + 1, candidate = [...content];
      while (end < blocks.length && plain(blocks[end]!)) {
        candidate.push({text: '\n'}, ...blocks[end]!.content);
        const value = candidate.map(s => s.text).join('');
        if (/(?<!\\)\\\]/.test(value)) { content = candidate; text = value; i = end; break; }
        end++;
      }
    }
    let start = 0, split = false;
    const pattern = /(`+)[\s\S]*?\1|(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g;
    for (const match of text.matchAll(pattern)) {
      const source = match[2]?.trim(); if (!source) continue;
      const before = slice(content, start, match.index!);
      if (before.some(s => s.text?.trim())) output.push({...block, id: split ? randomUUID() : block.id, content: inline(before)});
      output.push({...makeBlock('math', [{text: source}]),...(block.semantic?{semantic:block.semantic}:{}),...(block.semanticGroup?{semanticGroup:block.semanticGroup}:{})}); split = true;
      start = match.index! + match[0].length;
    }
    const remaining = slice(content, start, text.length);
    if (!split || remaining.some(s => s.text?.trim())) output.push({...block, id: split ? randomUUID() : block.id, content: inline(remaining)});
  }
  return output;
}
export function clipboardBlocks(text: string, html: string, markdown=readMarkdownTyping(), onImage?: (node: Element) => Block | undefined): Block[] {
  const plainBlocks=()=>[makeBlock('paragraph',text?[{text:text.replace(/\r\n?/g,'\n')}]:[])];
  if (!html) return markdown?markdownBlocks(text):plainBlocks();
  const doc = new DOMParser().parseFromString(html, 'text/html'), blocks: Block[] = [];
  doc.querySelectorAll('script,style,meta,link,iframe,object').forEach(node => node.remove());
  const groups=new Map<string,string>();
  function richBlock(type: BlockType, content: Segment[], node: Element): Block {
    const block=makeBlock(type,content),semantic=node.getAttribute('data-noema-semantic'),group=node.getAttribute('data-noema-group'),kind=node.getAttribute('data-noema-group-kind');
    const copiedType=node.getAttribute('data-noema-block-type');
    if (/^H[1-6]$/.test(node.tagName) && (copiedType==='heading1' || copiedType==='heading2')) block.type=copiedType;
    if (isSemanticKind(semantic)) block.semantic=semantic;
    if (group && group.length<=200 && isSemanticKind(kind)) {const key=JSON.stringify([group,kind]);if(!groups.has(key))groups.set(key,randomUUID());block.semanticGroup={id:groups.get(key)!,kind};}
    return block;
  }

  // Split rich text at images without losing marks inherited from inline wrappers.
  function appendContent(node: Element, type: BlockType) {
    const images = Array.from(node.querySelectorAll('img'));
    if (!images.length || !onImage) { blocks.push(richBlock(type, readSegments(node, false), node)); return; }
    const range = doc.createRange(); range.selectNodeContents(node);
    const appendText = () => {
      const wrapper = document.createElement('div'); wrapper.append(range.cloneContents());
      const content = readSegments(wrapper, false);
      if (content.some(segment => segment.text || segment.entityId || segment.math || segment.sourceReference||segment.bibliographicReference)) blocks.push(richBlock(type, content, node));
    };
    for (const image of images) {
      range.setEndBefore(image); appendText();
      const block = onImage(image); if (block) blocks.push(block);
      range.setStartAfter(image);
    }
    range.setEnd(node, node.childNodes.length); appendText();
  }

  function visit(parent: Element) {
    let inline = document.createElement('div');
    const flush = () => { if (inline.textContent?.trim() || inline.querySelector('br,img')) appendContent(inline, 'paragraph'); inline = document.createElement('div'); };
    for (const node of Array.from(parent.childNodes)) {
      if (!(node instanceof HTMLElement)) { inline.append(node.cloneNode(true)); continue; }
      const tag = node.tagName;
      if (node.getAttribute('data-noema-block-type') === 'columns' && !(onImage && node.querySelector('img'))) {
        flush();
        const cells = Array.from(node.children).slice(0,2).map(cell => readSegments(cell, false));
        blocks.push({...richBlock('columns', [], node), rows: [[cells[0] ?? [], cells[1] ?? []]]});
      } else if (tag === 'IMG' && onImage) {
        flush(); const block = onImage(node); if (block) blocks.push(block);
      } else if (tag === 'TABLE') {
        flush();
        if (onImage && node.querySelector('img')) {
          for (const row of Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node).slice(0,100)) {
            for (const cell of Array.from(row.cells).slice(0,20)) appendContent(cell, 'paragraph');
          }
          continue;
        }
        const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node).slice(0,100).map(row => Array.from(row.cells).slice(0,20).map(cell => readSegments(cell, false)));
        const width = Math.max(0,...rows.map(row => row.length));
        if (width) blocks.push({...richBlock('table',[],node), rows: rows.map(row => Array.from({length: width}, (_, i) => row[i] ?? []))});
      } else if (tag === 'HR') { flush(); blocks.push(richBlock('divider', [], node));
      } else if (tag === 'PRE') { flush(); blocks.push(richBlock('code', [{text: node.textContent || ''}], node));
      } else if (['UL','OL'].includes(tag)) { flush(); visit(node); }
      else if (['P','DIV','SECTION','ARTICLE','MAIN','BLOCKQUOTE','H1','H2','H3','H4','H5','H6','LI','PRE'].includes(tag)) {
        flush();
        if (tag !== 'LI' && node.querySelector('p,div,table,ul,ol,h1,h2,h3,h4,h5,h6,blockquote')) visit(node);
        else {
          const copy = node.cloneNode(true) as HTMLElement; copy.querySelectorAll('ul,ol').forEach(list => list.remove());
          const checkbox = copy.querySelector<HTMLInputElement>('input[type=checkbox]');
          const type: BlockType = tag === 'H1' ? 'heading1' : /^H[2-6]$/.test(tag) ? 'heading2' : tag === 'LI' ? checkbox ? 'todo' : node.parentElement?.tagName === 'OL' ? 'numbered' : 'bullet' : tag === 'BLOCKQUOTE' ? 'quote' : 'paragraph';
          const start = blocks.length; appendContent(copy, type);
          for (const block of blocks.slice(start)) if (block.type === 'todo') block.checked = checkbox?.checked ?? false;
          if (tag === 'LI') node.querySelectorAll(':scope > ul,:scope > ol').forEach(visit);
        }
      } else inline.append(node.cloneNode(true));
    }
    flush();
  }
  visit(doc.body);
  // Some applications wrap plain Markdown in one styled span.
  return blocks.length ? normalizeSemanticGroups(markdown?clipboardMathBlocks(blocks):blocks) : markdown?markdownBlocks(text):plainBlocks();
}

export interface ClipboardImage {block: Block; source: string; file?: File}
/** Keep binary clipboard images paired with their HTML position when available. */
export function clipboardContent(data: Pick<DataTransfer, 'files' | 'getData'>): {blocks: Block[]; images: ClipboardImage[]} {
  const images: ClipboardImage[] = [];
  const files = Array.from(data.files).filter(file => file.type.startsWith('image/'));
  const html = data.getData('text/html');
  const imageCount = html ? new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img').length : 0;
  const blocks = clipboardBlocks(data.getData('text/plain'), html, undefined, node => {
    const source = node.getAttribute('src') || node.getAttribute('data-src') || '';
    const block = {...makeBlock('image'), alt:(node.getAttribute('alt') || '').slice(0,1000)};
    const index = images.length;
    images.push({block, source, ...((files.length === imageCount || !source || /^(?:file:|blob:|cid:)/i.test(source)) && files[index] ? {file:files[index]} : {})});
    return block;
  });
  if (!images.length) for (const file of files) {
    const block = makeBlock('image'); blocks.push(block); images.push({block, source:'', file});
  }
  return {blocks, images};
}
