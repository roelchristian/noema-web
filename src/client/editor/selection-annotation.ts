import type { Entity } from '../../shared/domain';
import {mentionMatches, type MentionMatchOptions} from './mention-picker';

const normalize = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLocaleLowerCase();
/** Suggest both exact identity matches and plausible existing entities for highlighted text. */
export function annotationSuggestions(entities: Entity[], selection: string, query = '', options: MentionMatchOptions = {}) {
  const selected = normalize(selection), term = normalize(query);
  const names = (entity: Entity) => [entity.name, ...(entity.aliases ?? [])].map(normalize);
  const exact = mentionMatches(entities, selection, options).filter(entity => selected && names(entity).includes(selected));
  const results = mentionMatches(entities, term || selection, {...options, limit:20});
  return {exact, results};
}

/** Fit beside the selection rather than clamping a tall menu over its text. */
export function selectionPopoverPlacement(selection: {left: number; right: number; top: number; bottom: number}, menu: {width: number; height: number}, viewport: {width: number; height: number}) {
  const inset = 8, gap = 8;
  const above = Math.max(0, selection.top - gap - inset);
  const below = Math.max(0, viewport.height - inset - selection.bottom - gap);
  const left = Math.max(inset, Math.min((selection.left + selection.right - menu.width) / 2, viewport.width - menu.width - inset));
  if (menu.height <= above) return {left, top: selection.top - gap - menu.height, maxHeight: above};
  if (menu.height <= below) return {left, top: selection.bottom + gap, maxHeight: below};
  const sideTop = Math.max(inset, Math.min(selection.top, viewport.height - menu.height - inset));
  if (selection.left - gap - inset >= menu.width) return {left: selection.left - gap - menu.width, top: sideTop, maxHeight: viewport.height - inset * 2};
  if (viewport.width - selection.right - gap - inset >= menu.width) return {left: selection.right + gap, top: sideTop, maxHeight: viewport.height - inset * 2};
  return above >= below
    ? {left, top: inset, maxHeight: above}
    : {left, top: selection.bottom + gap, maxHeight: below};
}

/** Keep a compact toolbar anchored while its disclosure avoids the selected words. */
export function selectionActionPlacement(selection: {left:number;right:number;top:number;bottom:number}, trigger: {left:number;right:number;top:number;bottom:number}, menu: {width:number;height:number}, viewport: {width:number;height:number}) {
  const inset=8, gap=8;
  const left=Math.max(inset,Math.min(trigger.left,viewport.width-menu.width-inset));
  const top=trigger.bottom+gap;
  const below=Math.max(0,viewport.height-top-inset);
  if(menu.height<=below) {
    if(top>=selection.bottom || left>=selection.right || left+menu.width<=selection.left) return {left,top,maxHeight:below};
    if(selection.right+gap+menu.width<=viewport.width-inset) return {left:selection.right+gap,top,maxHeight:below};
    if(selection.left-gap-menu.width>=inset) return {left:selection.left-gap-menu.width,top,maxHeight:below};
  }
  return selectionPopoverPlacement(selection,menu,viewport);
}
