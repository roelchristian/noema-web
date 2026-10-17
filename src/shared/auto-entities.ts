import type { Block, Entity, Segment } from './domain.js';

const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Deterministic existing-entity links only; ambiguous names are left as text. */
export function identifyEntityMentions(blocks: Block[], entities: Entity[], vaultId: string) {
  const names = new Map<string, Entity | null>();
  for (const entity of entities) {
    if (entity.vault_id !== vaultId) continue;
    const name = normalize(entity.name);
    if (!name) continue;
    names.set(name, names.has(name) && names.get(name)?.id !== entity.id ? null : entity);
  }
  const candidates = [...names.entries()].filter((entry): entry is [string, Entity] => !!entry[1])
    .sort((a, b) => b[0].length - a[0].length);
  if (!candidates.length) return {blocks, count: 0};
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${candidates.map(([name]) => name.split(' ').map(part => escape(part).replace(/'/g, "['‘’]").replace(/"/g, '["“”]')).join('\\s+')).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  let count = 0;
  function segments(content: Segment[]): Segment[] {
    const output: Segment[] = [];
    let added = 0;
    for (let index = 0; index < content.length;) {
      const first = content[index]!;
      if (first.entityId || first.code || first.math || first.href) { output.push(first); index++; continue; }
      const run: {segment: Segment; start: number; end: number}[] = [];
      let text = '';
      while (index < content.length) {
        const segment = content[index]!;
        if (segment.entityId || segment.code || segment.math || segment.href) break;
        const start = text.length; text += segment.text ?? '';
        run.push({segment, start, end: text.length}); index++;
      }
      const appendText = (start: number, end: number) => {
        for (const item of run) {
          const from = Math.max(start, item.start), to = Math.min(end, item.end);
          if (from < to) { const {entityId, text: previousText, ...style} = item.segment; output.push({...style, text: text.slice(from, to)}); }
        }
      };
      pattern.lastIndex = 0;
      let start = 0;
      for (const match of text.matchAll(pattern)) {
        const entity = names.get(normalize(match[0]));
        if (!entity) continue;
        appendText(start, match.index!);
        output.push({entityId: entity.id}); added++;
        start = match.index! + match[0].length;
      }
      appendText(start, text.length);
    }
    // Respect the API's segment limit rather than turn a valid note unsaveable.
    if (!added || output.length > 1000) return content;
    count += added;
    return output;
  }
  const result = blocks.map(block => {
    if (block.type === 'math' || block.type === 'image') return block;
    if (block.type === 'table') {
      let changed = false;
      const rows = block.rows?.map(row => row.map(cell => { const next = segments(cell); changed ||= next !== cell; return next; }));
      return changed ? {...block, rows} : block;
    }
    const content = segments(block.content);
    return content === block.content ? block : {...block, content};
  });
  return {blocks: count ? result : blocks, count};
}
