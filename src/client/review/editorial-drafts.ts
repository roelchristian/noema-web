/** Session-only editor drafts survive Review Centre round trips. These are never queue states. */
const drafts=new Map<string,{base:string;replacement:string}>();
export function editorialDraft(key:string,base:string){const draft=drafts.get(key);return draft?.base===base?draft.replacement:undefined;}
export function saveEditorialDraft(key:string,base:string,replacement:string){drafts.set(key,{base,replacement});}
export function clearEditorialDraft(key:string){drafts.delete(key);}
