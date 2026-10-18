export interface LanguageComposition {scripts:number[];words:string[]}
/** Local evidence requests language inference; it never assigns a language itself. */
export function languageComposition(text:string):LanguageComposition {
  const scripts=[/\p{Script=Latin}/gu,/\p{Script=Cyrillic}/gu,/\p{Script=Greek}/gu,/\p{Script=Han}/gu,/\p{Script=Hiragana}|\p{Script=Katakana}/gu,/\p{Script=Arabic}/gu,/\p{Script=Devanagari}/gu,/\p{Script=Hangul}/gu].map(pattern=>(text.match(pattern)??[]).length);
  const count=scripts.reduce((sum,value)=>sum+value,0)||1;
  return {scripts:scripts.map(value=>value/count),words:[...new Set(text.normalize('NFKC').toLowerCase().match(/\p{L}{2,}/gu)??[])].slice(0,4096)};
}
export function languageCompositionChanged(previous:unknown,current:LanguageComposition):boolean {
  if(!previous||typeof previous!=='object')return false;
  const baseline=previous as Partial<LanguageComposition>;
  if(!Array.isArray(baseline.scripts)||!Array.isArray(baseline.words))return false;
  if(current.scripts.some((value,index)=>Math.abs(value-(baseline.scripts?.[index]??0))>=0.3))return true;
  if(current.words.length<12||baseline.words.length<12)return false;
  const before=new Set(baseline.words),overlap=current.words.filter(word=>before.has(word)).length;
  return overlap/Math.max(1,Math.min(current.words.length,baseline.words.length))<0.4;
}
