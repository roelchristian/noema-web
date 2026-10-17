import type { Block } from './domain.js';
export const semanticKinds = ['question','definition','example','claim','evidence','insight','summary','warning'] as const;
export type SemanticKind = typeof semanticKinds[number];
export interface SemanticGroup {id: string; kind: SemanticKind}
export const semanticFunctions: Record<SemanticKind, {label: string; icon: string; color: string; description: string}> = {
  question: {label:'Question',icon:'question-circle',color:'#8b6bd1',description:'Something to investigate or answer'},
  definition: {label:'Definition',icon:'creativework',color:'#5189c8',description:'Explain what a term means'},
  example: {label:'Example',icon:'sparkles',color:'#b88b36',description:'A concrete illustration'},
  claim: {label:'Claim',icon:'quote',color:'#bd7461',description:'A position or argument'},
  evidence: {label:'Evidence',icon:'source',color:'#58947b',description:'Support for an argument'},
  insight: {label:'Insight',icon:'lightbulb',color:'#b18a40',description:'An observation or connection'},
  summary: {label:'Summary',icon:'page',color:'#7485ab',description:'The essential points'},
  warning: {label:'Warning',icon:'alert',color:'#bd6c6c',description:'A caveat or limitation'},
};
export function isSemanticKind(value: unknown): value is SemanticKind {return semanticKinds.some(kind => kind === value);}
export type SemanticRun = {type:'block'; id:string; block:Block} | {type:'group'; id:string; kind:SemanticKind; blocks:Block[]};
/** Contiguous child records form a semantic parent without changing text block types. */
export function semanticRuns(blocks: Block[]): SemanticRun[] {
  const runs: SemanticRun[] = [];
  for (const block of blocks) {
    if (!block.semanticGroup) {runs.push({type:'block',id:block.id,block}); continue;}
    const last = runs.at(-1);
    if (last?.type === 'group' && last.id === block.semanticGroup.id) last.blocks.push(block);
    else runs.push({type:'group',id:block.semanticGroup.id,kind:block.semanticGroup.kind,blocks:[block]});
  }
  return runs;
}
export function normalizeSemanticGroups(blocks: Block[], uuid = () => crypto.randomUUID()): Block[] {
  const seen = new Set<string>(); let changed = false;
  const result = semanticRuns(blocks).flatMap(run => {
    if (run.type === 'block') return [run.block];
    if (run.blocks.length === 1 && (!run.blocks[0]!.semantic || run.blocks[0]!.semantic === run.kind)) {
      const {semanticGroup: group, ...block} = run.blocks[0]!; changed = true;
      return [{...block, semantic:block.semantic ?? group!.kind}];
    }
    if (seen.has(run.id)) {changed = true;const id = uuid();return run.blocks.map(block => ({...block,semanticGroup:{id,kind:run.kind}}));}
    seen.add(run.id); return run.blocks;
  });
  return changed ? result : blocks;
}
export function applySemantic(blocks: Block[], ids: string[], kind: SemanticKind, uuid = () => crypto.randomUUID()): Block[] {
  const selected = blocks.map((block,index) => ids.includes(block.id) ? index : -1).filter(index => index >= 0);
  if (!selected.length) return blocks;
  if (selected.length === 1) return blocks.map((block,index) => index === selected[0] ? {...block,semantic:kind} : block);
  let start = Math.min(...selected), end = Math.max(...selected);
  // Regroup touched parents whole, so a new parent never leaves overlapping fragments.
  const touched = new Set(blocks.slice(start,end+1).flatMap(block => block.semanticGroup ? [block.semanticGroup.id] : []));
  blocks.forEach((block,index) => {if (block.semanticGroup && touched.has(block.semanticGroup.id)) {start=Math.min(start,index);end=Math.max(end,index);}});
  const group = {id:uuid(),kind};
  return blocks.map((block,index) => index >= start && index <= end ? {...block,semanticGroup:group} : block);
}
export function removeSemanticGroup(blocks: Block[], id: string) {
  return blocks.map(block => {if (block.semanticGroup?.id !== id) return block;const {semanticGroup: _,...rest}=block;return rest;});
}
export function retagSemanticGroup(blocks: Block[], id: string, kind: SemanticKind) {
  return blocks.map(block => block.semanticGroup?.id === id ? {...block,semanticGroup:{id,kind}} : block);
}
export function semanticDragItems(blocks: Block[], source: string): {id:string}[] {
  return blocks.some(block => block.semanticGroup?.id === source) ? semanticRuns(blocks).map(run => ({id:run.id})) : blocks.map(block => ({id:block.id}));
}
export function reorderSemanticBlock(blocks: Block[], source: string, before: string | null): Block[] {
  const moving = blocks.filter(block => block.id === source || block.semanticGroup?.id === source);
  const target = before === null ? null : blocks.find(block => block.id === before || block.semanticGroup?.id === before);
  if (!moving.length || before !== null && !target || target && moving.includes(target)) return blocks;
  const rest = blocks.filter(block => !moving.includes(block)), index = target ? rest.indexOf(target) : rest.length;
  const next = [...rest]; next.splice(index,0,...moving);
  if (next.every((block,i) => block === blocks[i])) return blocks;
  if (moving.length === 1) {
    const original = moving[0]!, previousGroup = rest[index-1]?.semanticGroup, nextGroup = rest[index]?.semanticGroup;
    const parent = previousGroup && nextGroup?.id === previousGroup.id ? previousGroup : original.semanticGroup && (previousGroup?.id === original.semanticGroup.id || nextGroup?.id === original.semanticGroup.id) ? original.semanticGroup : undefined;
    if (parent?.id !== original.semanticGroup?.id) {
      const {semanticGroup: _,...block} = original;
      next[index] = parent ? {...block,semanticGroup:parent} : block;
    }
  }
  return normalizeSemanticGroups(next);
}
