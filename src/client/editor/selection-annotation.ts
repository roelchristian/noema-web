import type { Entity } from '../../shared/domain';

const normalize = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLocaleLowerCase();
export function annotationSuggestions(entities: Entity[], selection: string, query = '') {
  const selected = normalize(selection), term = normalize(query);
  const names = (entity: Entity) => [entity.name, ...(entity.aliases ?? [])].map(normalize);
  const exact = entities.filter(entity => selected && names(entity).includes(selected));
  const results = entities.filter(entity => !term || names(entity).some(name => name.includes(term))).sort((a, b) => {
    const score = (entity: Entity) => Number(names(entity).includes(term || selected));
    return score(b) - score(a) || a.name.localeCompare(b.name);
  }).slice(0, 20);
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
