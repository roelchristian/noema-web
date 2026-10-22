/** Presentation metadata only. Built-ins are immutable; custom management is deferred. */
export type PersonaOrigin = 'builtin' | 'custom';
export interface PersonaIdentity {id:string;version:number;origin:PersonaOrigin}
export const defaultPersonaId = 'oxford_don';
export const aiPersonas = Object.freeze([
  {id:'oxford_don',name:'Oxford Don',description:'Measured scholarship and careful distinctions.',character:'Erudite, cultivated, exacting, measured.',sample:'The distinction is a modest one, yet upon it the argument depends.'},
  {id:'conyo',name:'Conyo',description:'Warm, playful conversation with contemporary Manila ease.',character:'Sociable, playful, contemporary, articulate.',sample:'Think of evidence as your receipts: a confident claim still needs something to back it up.'},
  {id:'editor',name:'The Editor',description:'Precise, economical prose and constructive criticism.',character:'Direct, disciplined, critical, economical.',sample:'The claim is clear. The evidence supports a narrower conclusion.'},
  {id:'tutor',name:'The Tutor',description:'Patient explanations built step by step.',character:'Patient, systematic, lucid, encouraging.',sample:'Start with the claim. Next, ask what evidence would make it convincing.'},
  {id:'antiquarian',name:'The Eccentric Antiquarian',description:'Learned curiosity with old-fashioned charm.',character:'Curious, whimsical, learned, digressive.',sample:'Here is a curious little distinction, easily overlooked and well worth keeping.'},
  {id:'socratic',name:'The Socratic Gadfly',description:'Questions and counterexamples that sharpen understanding.',character:'Mischievous, penetrating, sceptical, inquisitive.',sample:'What would change your mind? That question tells us what evidence the claim needs.'},
  {id:'salon_wit',name:'The Salon Wit',description:'Urbane insight, lively prose, understated irony.',character:'Urbane, witty, incisive, elegantly irreverent.',sample:'Certainty makes a splendid entrance; evidence must still pay the bill.'},
].map(persona=>Object.freeze({...persona,version:1,origin:'builtin' as const})));
export const builtinPersonaIds = ['oxford_don','conyo','editor','tutor','antiquarian','socratic','salon_wit'] as const;
export type BuiltinPersonaId = typeof builtinPersonaIds[number];
export function isPersonaId(value:unknown):value is BuiltinPersonaId {return typeof value==='string'&&aiPersonas.some(p=>p.id===value);}
export function personaMetadata(value:unknown) {return aiPersonas.find(p=>p.id===value)??aiPersonas[0]!;}
export function personaIdentityName(persona:PersonaIdentity):string {return persona.origin==='builtin'?(aiPersonas.find(p=>p.id===persona.id)?.name??persona.id):persona.id;}
/** Preserve historical identities, including removed/custom IDs, without resolving their instructions. */
export function parsePersonaIdentity(value:unknown):PersonaIdentity|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid persona identity');
  const p=value as Record<string,unknown>;
  if(typeof p.id!=='string'||!/^[-a-z0-9_]{1,100}$/.test(p.id)||!Number.isSafeInteger(p.version)||(p.version as number)<1||!['builtin','custom'].includes(String(p.origin)))throw new Error('Invalid persona identity');
  return {id:p.id,version:p.version as number,origin:p.origin as PersonaOrigin};
}
