import type {NarrationPreferences} from './narration.js';

export const maxNarrationTextLength=32768;
const tokenCharacter=/[\p{L}\p{N}\p{M}_]/u;
const escapePattern=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Deliberately small language-specific allowlists. Ambiguous abbreviations stay authored.
const abbreviations:Record<string,Record<string,string>>={
  en:{'Dr.':'Doctor','Mr.':'Mister','Mrs.':'Missus','Prof.':'Professor','e.g.':'for example','i.e.':'that is','etc.':'et cetera'},
  de:{'Dr.':'Doktor','Prof.':'Professor','z.B.':'zum Beispiel','bzw.':'beziehungsweise'},
  fr:{'Dr.':'Docteur','Mme.':'Madame','M.':'Monsieur','p.ex.':'par exemple'},
  es:{'Dr.':'Doctor','Dra.':'Doctora','Sr.':'Señor','Sra.':'Señora','p.ej.':'por ejemplo'},
};
function boundary(text:string,start:number,end:number):boolean {
  const before=Array.from(text.slice(Math.max(0,start-2),start)).at(-1)??'',after=Array.from(text.slice(end,end+2))[0]??'';
  return !tokenCharacter.test(before)&&!tokenCharacter.test(after);
}
function spokenDate(value:string,locale:string):string {
  const [year,month,day]=value.split('-').map(Number),date=new Date(0);
  date.setUTCFullYear(year!,month!-1,day!);date.setUTCHours(0,0,0,0);
  if(!year||date.getUTCFullYear()!==year||date.getUTCMonth()!==month!-1||date.getUTCDate()!==day)return value;
  return new Intl.DateTimeFormat(locale,{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(date);
}

/** Derived narration only: replacements are literal, nonrecursive and never mutate source. */
export function transformNarration(text:string,preferences:NarrationPreferences):string {
  if(text.length>maxNarrationTextLength)throw new RangeError('Narration text is too long. Select fewer blocks.');
  const locale=preferences.locale,language=locale.split('-')[0]!;
  const dictionary=preferences.pronunciations.filter(entry=>!entry.language||entry.language===language).slice().sort((a,b)=>b.word.length-a.word.length);
  const expansions=preferences.rules.abbreviations==='expand'?(abbreviations[language]??{}):{};
  const alternatives=[...dictionary.map(entry=>escapePattern(entry.word)),...Object.keys(expansions).map(escapePattern),
    ...(preferences.rules.dates==='locale'?['\\d{4}-\\d{2}-\\d{2}']:[]),
    ...(preferences.rules.acronyms==='spell'?['[A-Z]{2,12}']:[]),
    ...(preferences.rules.numbers==='digits'?['[0-9]+']:[])].filter(Boolean);
  if(!alternatives.length)return text;
  const replacements=new RegExp(alternatives.join('|'),'giu');
  const plain=(value:string)=>value.replace(replacements,(match:string,index:number)=>{
    if(!boundary(value,index,index+match.length))return match;
    const entry=dictionary.find(entry=>entry.caseSensitive?entry.word===match:entry.word.toLocaleLowerCase(locale)===match.toLocaleLowerCase(locale));
    if(entry)return entry.spoken;
    const abbreviation=Object.keys(expansions).find(key=>key.toLocaleLowerCase(locale)===match.toLocaleLowerCase(locale));
    if(abbreviation)return expansions[abbreviation]!;
    if(preferences.rules.dates==='locale'&&/^\d{4}-\d{2}-\d{2}$/.test(match))return spokenDate(match,locale);
    if(preferences.rules.acronyms==='spell'&&/^[A-Z]{2,12}$/.test(match))return [...match].join(' ');
    if(preferences.rules.numbers==='digits'&&/^[0-9]+$/.test(match))return [...match].join(' ');
    return match;
  });
  // Capture protected spans directly: no placeholder can collide with authored text.
  // Unclosed fences/math delimiters protect the remaining input conservatively.
  const protectedSpans=/(^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[^\S\n]*(?:\n|$)|$(?![\s\S])))|(`+)([^`]|(?!\3)`)*\3|\$\$[\s\S]*?(?:\$\$|$(?![\s\S]))|\$[^\n$]+\$|\\\([\s\S]*?(?:\\\)|$(?![\s\S]))|\\\[[\s\S]*?(?:\\\]|$(?![\s\S]))|(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|www\.)[^\s<>]+|\]\([^\n)]*\)/gimu;
  let result='',offset=0;
  for(const match of text.matchAll(protectedSpans)){
    result+=plain(text.slice(offset,match.index))+match[0];offset=match.index+match[0].length;
    if(result.length>maxNarrationTextLength)throw new RangeError('Narration replacements are too long. Select fewer blocks.');
  }
  result+=plain(text.slice(offset));
  if(result.length>maxNarrationTextLength)throw new RangeError('Narration replacements are too long. Select fewer blocks.');
  return result;
}
