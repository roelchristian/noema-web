import type { Segment } from './domain.js';

/** DOM reads may reorder mark keys and merge adjacent text without changing content. */
export function segmentsEqual(left: Segment[], right: Segment[]) {
  function canonical(content: Segment[]) {
    const result: {value: string; marks: string; entity?: string; atomic?: boolean}[] = [];
    for (const segment of content) {
      if (segment.entityId) {
        result.push({entity: segment.entityId, value: segment.mentionText ?? '', marks: ''});
        continue;
      }
      const value = segment.text ?? '';
      if (!value && !segment.math) continue;
      const marks = JSON.stringify([!!segment.bold, !!segment.italic, !!segment.underline, !!segment.strike, !!segment.code, !!segment.math, segment.href ?? '', !!segment.skipAutoTag]);
      const last = result.at(-1);
      if (last && !last.entity && !last.atomic && !segment.math && last.marks === marks) last.value += value;
      else result.push({value, marks, ...(segment.math ? {atomic: true} : {})});
    }
    return JSON.stringify(result);
  }
  return canonical(left) === canonical(right);
}
