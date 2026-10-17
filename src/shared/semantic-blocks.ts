import {randomUUID} from './uuid.js';
import type { Block } from './domain.js';
export const semanticKinds = ['question','definition','example','claim','evidence','insight','summary','warning','ai-explanation'] as const;
export type SemanticKind = typeof semanticKinds[number];
/** Source block IDs and the original excerpt are optional and persist with the explanation. */
export interface SemanticGroup {id: string; kind: SemanticKind; source?: {blockIds: string[]; excerpt: string}}
export const semanticFunctions: Record<SemanticKind, {label: string; icon: string; color: string; description: string}> = {
  'ai-explanation': {label:'AI Explanation',icon:'sparkles',color:'#8b79cf',description:'AI-generated explanation · permanent tag'},
  question: {label:'Question',icon:'question-circle',color:'#8b6bd1',description:'Something to investigate or answer'},
  definition: {label:'Definition',icon:'creativework',color:'#5189c8',description:'Explain what a term means'},
  example: {label:'Example',icon:'sparkles',color:'#b88b36',description:'A concrete illustration'},
  claim: {label:'Claim',icon:'quote',color:'#bd7461',description:'A position or argument'},
  evidence: {label:'Evidence',icon:'source',color:'#58947b',description:'Support for an argument'},
  insight: {label:'Insight',icon:'lightbulb',color:'#b18a40',description:'An observation or connection'},
  summary: {label:'Summary',icon:'page',color:'#7485ab',description:'The essential points'},
  warning: {label:'Warning',icon:'alert',color:'#bd6c6c',description:'A caveat or limitation'},
};
export const editableSemanticKinds = semanticKinds.filter(kind => kind !== 'ai-explanation');
export function isAIExplanation(block: Block) {return block.semantic === 'ai-explanation' || block.semanticGroup?.kind === 'ai-explanation';}
/** Regenerate a shared explanation for its whole passage, including overlapping legacy explanations. */
export function aiExplanationSources(blocks: Block[], ids: string[]): Block[] {
  const sources = new Set(blocks.filter(block => ids.includes(block.id)).flatMap(block => isAIExplanation(block) ? block.semanticGroup?.source?.blockIds ?? [] : [block.id]));
  let previousSize = -1;
  while (previousSize !== sources.size) {
    previousSize = sources.size;
    for (const block of blocks) {
      const linked = isAIExplanation(block) ? block.semanticGroup?.source?.blockIds : undefined;
      if (linked?.some(id => sources.has(id))) linked.forEach(id => sources.add(id));
    }
  }
  return blocks.filter(block => sources.has(block.id) && !isAIExplanation(block));
}
export function aiExplanationsForSources(blocks: Block[], ids: string[]): Block[] {
  const sources = new Set(ids);
  return blocks.filter(block => isAIExplanation(block) && block.semanticGroup?.source?.blockIds.some(id => sources.has(id)));
}
/** Find surviving explanations linked to any source block removed by an editor change. */
export function explanationsLinkedToDeletedBlocks(previous: Block[], next: Block[]): string[] {
  const remaining = new Set(next.map(block => block.id));
  const removed = new Set(previous.filter(block => !remaining.has(block.id)).map(block => block.id));
  if (!removed.size) return [];
  return [...new Set(next.flatMap(block => {
    const group = block.semanticGroup;
    return isAIExplanation(block) && group?.source?.blockIds.some(id => removed.has(id)) ? [group.id] : [];
  }))];
}
/** Keep provenance when editing, splitting, dragging, or detaching generated content. */
export function preserveAIExplanationTags(previous: Block[], next: Block[]): Block[] {
  const protectedIds = new Set(previous.filter(isAIExplanation).map(block => block.id));
  return next.map(block => (protectedIds.has(block.id) || block.semanticGroup?.kind === 'ai-explanation') && block.semantic !== 'ai-explanation' ? {...block,semantic:'ai-explanation'} : block);
}
export function isSemanticKind(value: unknown): value is SemanticKind {return semanticKinds.some(kind => kind === value);}
export type SemanticRun = {type:'block'; id:string; block:Block} | {type:'group'; id:string; kind:SemanticKind; blocks:Block[]};
/** Contiguous child records form a semantic parent without changing text block types. */
export function semanticRuns(blocks: Block[]): SemanticRun[] {
  const runs: SemanticRun[] = [];
  for (const block of blocks) {
    if (!block.semanticGroup) {runs.push({type:'block',id:block.id,block}); continue;}
    const last = runs.at(-1);
    if (last?.type === 'group' && last.id === block.semanticGroup.id && last.blocks[0]!.column?.id === block.column?.id && last.blocks[0]!.column?.index === block.column?.index) last.blocks.push(block);
    else runs.push({type:'group',id:block.semanticGroup.id,kind:block.semanticGroup.kind,blocks:[block]});
  }
  return runs;
}
export function normalizeSemanticGroups(blocks: Block[], uuid = () => randomUUID()): Block[] {
  const seen = new Set<string>(); let changed = false;
  const result = semanticRuns(blocks).flatMap(run => {
    if (run.type === 'block') return [run.block];
    if (run.kind !== 'ai-explanation' && run.blocks.length === 1 && (!run.blocks[0]!.semantic || run.blocks[0]!.semantic === run.kind)) {
      const {semanticGroup: group, ...block} = run.blocks[0]!; changed = true;
      return [{...block, semantic:block.semantic ?? group!.kind}];
    }
    if (seen.has(run.id)) {changed = true;const id = uuid();return run.blocks.map(block => ({...block,semanticGroup:{...run.blocks[0]!.semanticGroup!,id,kind:run.kind}}));}
    seen.add(run.id); return run.blocks;
  });
  return changed ? result : blocks;
}
export function applySemantic(blocks: Block[], ids: string[], kind: SemanticKind, uuid = () => randomUUID()): Block[] {
  const selected = blocks.map((block,index) => ids.includes(block.id) ? index : -1).filter(index => index >= 0);
  if (!selected.length) return blocks;
  if (selected.length === 1) return blocks.map((block,index) => index === selected[0] && !isAIExplanation(block) ? {...block,semantic:kind} : block);
  let start = Math.min(...selected), end = Math.max(...selected);
  // Regroup touched parents whole, so a new parent never leaves overlapping fragments.
  const touched = new Set(blocks.slice(start,end+1).flatMap(block => block.semanticGroup ? [block.semanticGroup.id] : []));
  blocks.forEach((block,index) => {if (block.semanticGroup && touched.has(block.semanticGroup.id)) {start=Math.min(start,index);end=Math.max(end,index);}});
  if (blocks.slice(start,end+1).some(block => block.semanticGroup?.kind === 'ai-explanation')) return blocks;
  const group = {id:uuid(),kind};
  return blocks.map((block,index) => index >= start && index <= end ? {...block,semanticGroup:group} : block);
}
export function removeSemanticGroup(blocks: Block[], id: string) {
  return blocks.map(block => {if (block.semanticGroup?.id !== id || block.semanticGroup.kind === 'ai-explanation') return block;const {semanticGroup: _,...rest}=block;return rest;});
}
export function retagSemanticGroup(blocks: Block[], id: string, kind: SemanticKind) {
  return blocks.map(block => block.semanticGroup?.id === id && block.semanticGroup.kind !== 'ai-explanation' ? {...block,semanticGroup:{id,kind}} : block);
}
export function semanticDragItems(blocks: Block[], source: string): {id:string}[] {
  if (blocks.some(block => block.id === source && isAIExplanation(block))) return [];
  return blocks.some(block => block.semanticGroup?.id === source) ? semanticRuns(blocks).map(run => ({id:run.id})) : blocks.map(block => ({id:block.id}));
}
export function reorderSemanticBlock(blocks: Block[], source: string, before: string | null): Block[] {
  const moving = blocks.filter(block => block.id === source || block.semanticGroup?.id === source);
  let target = before === null ? null : blocks.find(block => block.id === before || block.semanticGroup?.id === before);
  if (!moving.length || before !== null && !target || target && moving.includes(target)) return blocks;
  if (moving.some(block => isAIExplanation(block) && block.semanticGroup?.id !== source)) return blocks;
  if (target?.semanticGroup?.kind === 'ai-explanation') target = blocks.find(block => block.semanticGroup?.id === target!.semanticGroup!.id)!;
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
  const destination = target?.column;
  for (let offset = 0; offset < moving.length; offset++) {
    const block = next[index + offset]!;
    if (block.column?.id !== destination?.id || block.column?.index !== destination?.index) next[index + offset] = {...block,column:destination};
  }
  return normalizeSemanticGroups(preserveAIExplanationTags(blocks,next));
}
