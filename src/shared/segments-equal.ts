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
      if (!value && !segment.math && !segment.sourceReference && !segment.bibliographicReference) continue;
      const marks = JSON.stringify([!!segment.bold, !!segment.italic, !!segment.underline, !!segment.strike, !!segment.superscript, !!segment.subscript, !!segment.code, !!segment.math, segment.href ?? '', !!segment.skipAutoTag, segment.sourceReference ?? null, segment.bibliographicReference ?? null]);
      const last = result.at(-1);
      if (last && !last.entity && !last.atomic && !segment.math && !segment.sourceReference && !segment.bibliographicReference && last.marks === marks) last.value += value;
      else result.push({value, marks, ...(segment.math || segment.sourceReference || segment.bibliographicReference ? {atomic: true} : {})});
    }
    return JSON.stringify(result);
  }
  return canonical(left) === canonical(right);
}
