import {sortCitationRuns} from './citations.js';
import type { Segment } from './domain.js';

/** DOM reads may reorder mark keys and merge adjacent text without changing content. */
export function segmentsEqual(left: Segment[], right: Segment[]) {
  function canonical(content: Segment[]) {
    const result: {value: string; marks: string; entity?: string; atomic?: boolean}[] = [];
    // Adjacent citation order is presentation; preserve the editor's content equality.
    for (const segment of sortCitationRuns(content,(left,right)=>left.id.localeCompare(right.id))) {
      if (segment.entityId) {
        result.push({entity: segment.entityId, value: segment.mentionText ?? '', marks: segment.skipAutoTag ? 'occurrence' : ''});
        continue;
      }
      const value = segment.text ?? '';
      if (!value && !segment.math && !segment.sourceReference) continue;
      const marks = JSON.stringify([!!segment.bold, !!segment.italic, !!segment.underline, !!segment.strike, !!segment.code, !!segment.math, segment.href ?? '', !!segment.skipAutoTag, segment.sourceReference ?? null]);
      const last = result.at(-1);
      if (last && !last.entity && !last.atomic && !segment.math && !segment.sourceReference && last.marks === marks) last.value += value;
      else result.push({value, marks, ...(segment.math || segment.sourceReference ? {atomic: true} : {})});
    }
    return JSON.stringify(result);
  }
  return canonical(left) === canonical(right);
}
