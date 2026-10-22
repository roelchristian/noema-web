import type {Block,Page} from './domain.js';

// Only values owned here are trusted. Object.isFrozen alone does not establish
// deep immutability. Mutable callers are detached once at the boundary.
const owned = new WeakSet<object>();
function freeze<T>(value:T):T {
  if(value && typeof value==='object' && !owned.has(value)) {
    for(const child of Object.values(value)) freeze(child);
    Object.freeze(value); owned.add(value);
  }
  return value;
}
export function immutableBlocks(blocks:Block[], previous?:Block[]):Block[] {
  if(owned.has(blocks))return blocks;
  const byId=new Map(previous?.map(block=>[block.id,block]));
  const result=blocks.map(block=>{
    if(owned.has(block))return block;
    const old=byId.get(block.id);
    // Full comparison is confined to new/untrusted blocks, never shared rows.
    if(old && owned.has(old) && JSON.stringify(old)===JSON.stringify(block))return old;
    return freeze(structuredClone(block));
  });
  if(previous && owned.has(previous) && result.length===previous.length && result.every((block,i)=>block===previous[i]))return previous;
  owned.add(result);return Object.freeze(result) as Block[];
}
export function sameDocument(a:{title:string;blocks:Block[];featuredImageId?:string|null}|null,b:typeof a) {
  return a===b || !!a && !!b && a.title===b.title && a.blocks===b.blocks && (a.featuredImageId??null)===(b.featuredImageId??null);
}

/** Cache payload work by owned block identity; aggregation may still walk refs. */
export function memoizeBlock<T>(compute:(block:Block)=>T):(block:Block)=>T {
  const cache=new WeakMap<Block,T>();
  return block=>{
    if(!owned.has(block))return compute(block);
    if(cache.has(block))return cache.get(block)!;
    const value=compute(block);cache.set(block,value);return value;
  };
}

// Page metadata is JSON data too. Adopt it once rather than cloning a large
// entity-match cache or enrichment payload again for every pending save.
function immutableValue<T>(value:T):T {
  if(!value || typeof value!=='object' || owned.has(value))return value;
  const result=Array.isArray(value) ? value.map(immutableValue) : Object.fromEntries(Object.entries(value).map(([key,child])=>[key,immutableValue(child)]));
  owned.add(result);return Object.freeze(result) as T;
}
export function immutablePage(page:Page, previous?:Block[]):Page {
  const blocks=immutableBlocks(page.blocks,previous);
  const entries=Object.entries(page).map(([key,value])=>[key,key==='blocks'?blocks:immutableValue(value)] as const);
  return entries.every(([key,value])=>page[key as keyof Page]===value) ? page : Object.fromEntries(entries) as unknown as Page;
}
