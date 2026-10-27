/** Presentation metadata only. Built-ins are immutable; custom management is deferred. */
export type PersonaOrigin = 'builtin' | 'custom';
export type PersonaExpression = 'subtle'|'expressive'|'immersive';
export const defaultPersonaExpression:PersonaExpression='expressive';
export const personaExpressions = ['subtle','expressive','immersive'] as const;
export function parsePersonaExpression(value:unknown):PersonaExpression {if(!personaExpressions.includes(value as PersonaExpression))throw new Error('Invalid persona expression');return value as PersonaExpression;}
export interface PersonaIdentity {id:string;version:number;origin:PersonaOrigin;expression?:PersonaExpression}
export const defaultPersonaId = 'oxford_don';
export const aiPersonasV1 = Object.freeze([
  {id:'oxford_don',name:'Oxford Don',description:'Measured scholarship and careful distinctions.',character:'Erudite, cultivated, exacting, measured.',sample:'The distinction is a modest one, yet upon it the argument depends.'},
  {id:'divinity_student',name:'The Divinity Student',description:'Catholic theological formation with scholarly care and charity.',character:'Scholarly, contemplative, devout, discerning, charitable.',sample:'Let us distinguish what the Church teaches definitively from what remains open to theological inquiry.'},
  {id:'editor',name:'The Editor',description:'Precise, economical prose and constructive criticism.',character:'Direct, disciplined, critical, economical.',sample:'The claim is clear. The evidence supports a narrower conclusion.'},
  {id:'tutor',name:'The Tutor',description:'Patient explanations built step by step.',character:'Patient, systematic, lucid, encouraging.',sample:'Start with the claim. Next, ask what evidence would make it convincing.'},
  {id:'antiquarian',name:'The Eccentric Antiquarian',description:'Learned curiosity with old-fashioned charm.',character:'Curious, whimsical, learned, digressive.',sample:'Here is a curious little distinction, easily overlooked and well worth keeping.'},
  {id:'socratic',name:'The Socratic Gadfly',description:'Questions and counterexamples that sharpen understanding.',character:'Mischievous, penetrating, sceptical, inquisitive.',sample:'What would change your mind? That question tells us what evidence the claim needs.'},
  {id:'salon_wit',name:'The Salon Wit',description:'Urbane insight, lively prose, understated irony.',character:'Urbane, witty, incisive, elegantly irreverent.',sample:'Certainty makes a splendid entrance; evidence must still pay the bill.'},
].map(persona=>Object.freeze({...persona,version:1,origin:'builtin' as const})));
export const aiPersonas=Object.freeze(aiPersonasV1.map(p=>Object.freeze({...p,version:2,...(p.id==='oxford_don'?{
  description:'Cultivated Oxbridge scholarship in balanced, predominantly hypotactic prose at every expression level.',
  character:'Precise, discriminating, measured; elegant periodic sentences, restrained ornament and dry understatement.',
  sample:'Although the distinction may appear modest, it governs the argument, since what the evidence establishes must be distinguished from what, under less exacting scrutiny, we might be inclined to infer.',
}:p.id==='antiquarian'?{
  description:'Sir Thomas Browne’s Urne-Buriall: sonorous, ornate hypotaxis, learned Latinate diction and meditative antithesis.',
  character:'Grave, contemplative, richly ornamented; nested periods, controlled digression and occasional pertinent, untranslated classics.',
  sample:'Though the archive, in whose recesses so many purposes lie interred, may preserve the circumstance of an action, its intention, which no catalogue can restore by enumeration alone, remains obscure; and thus the very plenitude of our records may disclose the poverty of our understanding.',
}:{} )})));
export const builtinPersonaIds = ['oxford_don','divinity_student','editor','tutor','antiquarian','socratic','salon_wit'] as const;
export type BuiltinPersonaId = typeof builtinPersonaIds[number];
export function isPersonaId(value:unknown):value is BuiltinPersonaId {return typeof value==='string'&&aiPersonas.some(p=>p.id===value);}
export function personaMetadata(value:unknown) {return aiPersonas.find(p=>p.id===value)??aiPersonas[0]!;}
// Retired identities remain readable without becoming selectable built-ins.
export function personaIdentityName(persona:PersonaIdentity):string {return persona.origin==='builtin'?(persona.id==='conyo'?'Conyo':aiPersonas.find(p=>p.id===persona.id)?.name??persona.id):persona.id;}
/** Preserve historical identities, including removed/custom IDs, without resolving their instructions. */
export function parsePersonaIdentity(value:unknown):PersonaIdentity|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid persona identity');
  const p=value as Record<string,unknown>;
  if(typeof p.id!=='string'||!/^[-a-z0-9_]{1,100}$/.test(p.id)||!Number.isSafeInteger(p.version)||(p.version as number)<1||!['builtin','custom'].includes(String(p.origin)))throw new Error('Invalid persona identity');
  return {id:p.id,version:p.version as number,origin:p.origin as PersonaOrigin,...(p.expression===undefined?{}:{expression:parsePersonaExpression(p.expression)})};
}
