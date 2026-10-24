import type {SourceReference} from './domain.js';
import type {PageReference} from './embeddings.js';

export const temporalExtractorVersion='english-historical-v2';
export type TemporalPrecision='day'|'month'|'year'|'interval'|'century';
export type TemporalCalendar='gregorian'|'julian';
export interface TemporalDate {id:string;value:string;precision:TemporalPrecision;calendar:TemporalCalendar}
export interface TemporalExpression {start:number;end:number;text:string;date:TemporalDate|null;reason:string|null}
export type TemporalLayer='personal'|'knowledge'|'historical';
export interface TemporalCuration {label:string;annotation:string;pinned:boolean;importance:'ordinary'|'notable'|'important';personalPriority:'ordinary'|'important';layer:TemporalLayer}
export interface TemporalPageReference extends PageReference {blockId:string;blockStart:number;blockEnd:number;blockHash:string}
export type TemporalEvidence={status:'current'|'unresolved';reference:TemporalPageReference;reason:string|null}|{status:'stale'|'unavailable';reason:string};
export type TemporalSourceEvidence={status:'current'|'unresolved';sourceReference:SourceReference;reason:string|null}|{status:'stale'|'unavailable';reason:string};
export type TemporalPropertyEvidence={status:'current';propertyId:string;raw:string;name:string;reason:null}|{status:'stale'|'unavailable';reason:string};
export interface TemporalSourceSummary {startLine?:number;context?:string;id:string;sourceId:string;fileId:string;text:string;title:string}
export interface TemporalPropertySummary {id:string;entityId:string;name:string;raw:string;title:string}
export interface TemporalMentionSummary {id:string;pageId:string;blockId:string;text:string;title:string}
export interface TemporalRelationSummary {layer?:TemporalLayer|null;id:string;entityId:string;mentionId:string|null;kind:string;origin:string;status:string;confidence:number|null;name:string;sourceMentionId?:string|null;propertyId?:string|null;version?:string;evidence:TemporalEvidence|TemporalSourceEvidence|TemporalPropertyEvidence|{status:'unresolved';reason:string}}
export interface TemporalItem {date:TemporalDate;curation:TemporalCuration|null;mentions:TemporalMentionSummary[];mentionCount:number;relations:TemporalRelationSummary[];relationCount:number;layer:TemporalLayer;sources?:TemporalSourceSummary[];sourceCount?:number;properties?:TemporalPropertySummary[];propertyCount?:number;proposals?:TemporalRelationSummary[];proposalCount?:number}
export interface TemporalResults {items:TemporalItem[];indexing:{refreshed:number;pending:number};nextOffset:number|null}
export interface TemporalDetail extends TemporalItem {nextMentionOffset:number|null;nextRelationOffset:number|null;nextSourceOffset?:number|null;nextPropertyOffset?:number|null;nextProposalOffset?:number|null}

const months='January February March April May June July August September October November December'.split(' ');
const monthPattern=months.join('|');
/** Historical years use civil numbering: -0001 is 1 BCE; year zero is invalid.
 * Calendars are independent identities. No conversion is performed here. */
export function temporalDate(value:string,calendar:TemporalCalendar='gregorian'):TemporalDate|null {
 if(calendar!=='gregorian'&&calendar!=='julian')return null;
 if(value.startsWith('~')) {
  const nominal=temporalDate(value.slice(1),calendar);
  return nominal&&!['interval','century'].includes(nominal.precision)&&!value.slice(1).includes('~')?{...nominal,id:`${calendar}:${nominal.precision}:${value}`,value}:null;
 }
 if(value.includes('/')) {
  const parts=value.split('/'),start=temporalDate(parts[0]!,calendar),end=parts.length===2?temporalDate(parts[1]!,calendar):null;
  if(!start||!end||['interval','century'].includes(start.precision)||start.precision!==end.precision||value.includes('~'))return null;
  const first=temporalBounds(start),last=temporalBounds(end);
  return first&&last&&first.from<=last.from?{id:`${calendar}:interval:${value}`,value,precision:'interval',calendar}:null;
 }
 const century=/^C(-?)([1-9]\d?)$/.exec(value);
 if(century)return {id:`${calendar}:century:${value}`,value,precision:'century',calendar};
 const match=/^(-?)(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
 if(!match)return null;
 const civilYear=Number(match[2]),year=match[1]?1-civilYear:civilYear,month=Number(match[3]),day=Number(match[4]);
 if(civilYear<1||civilYear>9999||match[3]&&(month<1||month>12))return null;
 const leap=year%4===0&&(calendar==='julian'||year%100!==0||year%400===0);
 if(match[4]&&(day<1||day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1]!))return null;
 const precision=match[4]?'day':match[3]?'month':'year';
 return {id:`${calendar}:${precision}:${value}`,value,precision,calendar};
}

/** Query keys are calendar-local chronological ordinals, not converted timestamps.
 * Approximation has no invented tolerance: bounds cover only the nominal precision
 * span; callers must retain its uncertainty when presenting a query result. */
export function temporalBounds(date:TemporalDate):{from:number;to:number;approximate:boolean}|null {
 if(date.value.startsWith('~')) {const nominal=temporalDate(date.value.slice(1),date.calendar),bounds=nominal&&temporalBounds(nominal);return bounds?{...bounds,approximate:true}:null;}
 if(date.precision==='interval') {
  const [a,b]=date.value.split('/'),start=temporalDate(a!,date.calendar),end=temporalDate(b!,date.calendar),lower=start&&temporalBounds(start),upper=end&&temporalBounds(end);
  return lower&&upper?{from:lower.from,to:upper.to,approximate:false}:null;
 }
 if(date.precision==='century') {
  const match=/^C(-?)([1-9]\d?)$/.exec(date.value);if(!match)return null;
  const n=Number(match[2]),first=match[1]?1-n*100:(n-1)*100+1,last=match[1]?100-n*100:n*100;
  return {from:first*372+32,to:last*372+403,approximate:false};
 }
 const match=/^(-?)(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date.value);if(!match)return null;
 const year=match[1]?1-Number(match[2]):Number(match[2]),month=Number(match[3]),day=Number(match[4]);
 const base=year*372;
 return {from:base+(month||1)*31+(day||1),to:base+(month||12)*31+(day||31),approximate:false};
}
export function temporalDisplay(date:TemporalDate):string {
 if(date.value.startsWith('~'))return 'circa '+temporalDisplay(temporalDate(date.value.slice(1),date.calendar)!);
 if(date.precision==='interval')return date.value.split('/').map(value=>temporalDisplay(temporalDate(value,date.calendar)!)).join(' – ');
 if(date.precision==='century') {const match=/^C(-?)(\d+)$/.exec(date.value)!;return `${Number(match[2])}${Number(match[2])%100>=11&&Number(match[2])%100<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[Number(match[2])%10]??'th'} century${match[1]?' BCE':''}`;}
 const match=/^(-?)(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date.value)!;
 return `${match[4]?Number(match[4])+' ':''}${match[3]?months[Number(match[3])-1]+' ':''}${Number(match[2])}${match[1]?' BCE':''}`;
}

/** English civil expressions only. Unsupported expressions consume their full span so
 * neither an ambiguous numeric date nor a range leaks a fabricated inner year. */
export function extractTemporal(text:string):TemporalExpression[] {
 const result:TemporalExpression[]=[],occupied:{start:number;end:number}[]=[];
 const add=(start:number,end:number,date:TemporalDate|null,reason:string|null)=>{
  if(occupied.some(span=>start<span.end&&end>span.start))return;
  occupied.push({start,end});result.push({start,end,text:text.slice(start,end),date,reason});
 };
 // Qualifiers bind to the complete expression before any exact recognizer runs.
 // Keep deliberately unsupported forms anchored, including short BCE years and
 // ordinal days, instead of accepting an exact date from inside their span.
 const guardedMonths=monthPattern+'|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
 const historicalAtom=String.raw`(?:(?:\d{1,3}(?:st|nd|rd|th)?\s*)?(?:${guardedMonths})\.?\s*(?:\d{1,2}(?:st|nd|rd|th)?,?\s*)?\d{1,4}|\d{1,4}(?:st|nd|rd|th)?(?:\s+century)?)(?:\s*(?:BCE|BC))?`;
 const guardQualifier=String.raw`(?:circa|about|approximately|c\.|ca\.?|early|late|mid[ -]?|uncertain(?:ly)?|possibly|probably|perhaps|around)`;
 const historicalRange=new RegExp(String.raw`\b(?:(?:in|between|from)\s+)?(?:${guardQualifier}\s*)?${historicalAtom}\s*(?:and|or|to|/|–|—|-)\s*(?:${guardQualifier}\s*)?${historicalAtom}(?:\s*\([^)]+\))?`,'gi');
 for(const match of text.matchAll(historicalRange)) {
  // A conjunction of complete dates remains independent evidence, not a range.
  if(/and/i.test(match[0])&&!/^between\b/i.test(match[0])&&new RegExp(guardedMonths,'i').test(match[0]))continue;
  if(/^(?:between\s+\d{4}\s+and\s+\d{4}|(?:from\s+)?\d{4}\s*(?:to|–|—|-)\s*\d{4})(?:\s*\((?:Gregorian|Julian|Old Style|New Style)\))?$/i.test(match[0]))continue;
  if(/and|or/i.test(match[0])||new RegExp(String.raw`(?:${guardedMonths})|BCE|BC|${guardQualifier}`,'i').test(match[0]))add(match.index,match.index+match[0].length,null,'Unsupported historical bounds or alternatives');
 }
 const abbreviatedBCE=/\b(?:\d{1,3}(?:st|nd|rd|th)?\s*)?(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s*\d{1,4}\s*(?:BCE|BC)\b(?:\s*\([^)]+\))?/gi;
 for(const match of text.matchAll(abbreviatedBCE))add(match.index,match.index+match[0].length,null,'Unsupported abbreviated BCE expression');
 const qualifierPattern=new RegExp(String.raw`\b(?:circa|about|approximately|c\.|ca\.?|early|late|mid[ -]?|uncertain(?:ly)?|possibly|probably|perhaps|around)\s*${historicalAtom}(?:\s*(?:–|—|-|to|and|/)\s*${historicalAtom})?(?:\s*\([^)]+\))?\s*\??`,'gi');
 for(const match of text.matchAll(qualifierPattern)) {
  // Only the already-supported unqualified four-digit nominal year is resolved.
  if(/^(?:circa|about|approximately|c\.)\s*\d{4}(?:\s*\((?:Gregorian|Julian|Old Style|New Style)\))?$/i.test(match[0].trim()))continue;
  add(match.index,match.index+match[0].trimEnd().length,null,'Unsupported historical qualifier or bounds');
 }
 const ordinalBCE=new RegExp(String.raw`\b\d{1,3}(?:st|nd|rd|th)\s*(?:${monthPattern})\s*\d{1,4}\s*(?:BCE|BC)\b(?:\s*\([^)]+\))?`,'gi');
 for(const match of text.matchAll(ordinalBCE))add(match.index,match.index+match[0].length,null,'Unsupported ordinal BCE expression');
 const bceRange=/\b\d{1,4}\s*(?:BCE|BC)\s*(?:\/|–|—|-|to|and)\s*\d{1,4}\s*(?:BCE|BC)\b(?:\s*\([^)]+\))?/gi;
 for(const match of text.matchAll(bceRange))add(match.index,match.index+match[0].length,null,'Unsupported historical qualifier or bounds');

 // Unsupported combinations consume their complete span before inner recognizers.
 const historicalCore=`(?:(?:in|circa|about|approximately|c\\.)\\s+)?(?:(?:\\d{1,2}(?:st|nd|rd|th)?\\s+)?(?:${monthPattern})\\s+)?\\d{1,4}(?:\\s*(?:BCE|BC))?(?:\\s*(?:–|—|-|to|and)\\s*\\d{1,4}(?:\\s*(?:BCE|BC))?)?`;
 const protectedHistorical=[
  new RegExp(`\\b(?:${monthPattern})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{1,4}\\s*(?:BCE|BC)\\b(?:\\s*\\([^)]+\\))?`,'gi'),
  /\b(?:circa|about|approximately|c\.)\s*\d{4}\s*(?:–|—|-|to|and)\s*\d{4}(?:\s*(?:BCE|BC))?\b/gi,
  /\b(?:circa|about|approximately|early|late|mid[ -]?)\s*\d{1,2}(?:st|nd|rd|th)\s+century(?:\s+(?:BCE|BC))?\b/gi,
  /\b\d{1,2}(?:st|nd|rd|th)\s+century(?:\s+(?:BCE|BC))?\s*\((?!(?:Julian|Gregorian|Old Style|New Style)\))[^)]+\)/gi,
  new RegExp(`\\b${historicalCore}\\s*\\((?!(?:Julian|Gregorian|Old Style|New Style)\\))[^)]+\\)`,'gi'),
  new RegExp(`\\b${historicalCore}(?:\\s*\\([^)]+\\))?\\s*\\?`,'gi'),
  /\b\d{1,2}(?:st|nd|rd|th)\s+century(?:\s+(?:BCE|BC))?\s*\?/gi,
  /\b(?:between|from)\s+\d{4}\s+(?:and|to)\s+(?:circa|about|approximately)\s+\d{4}\b/gi,
  /\b(?:circa|about|approximately|c\.)\s*\d{1,4}\s*(?:BCE|BC)\b/gi,
  /\b(?:between\s+|from\s+)?\d{1,4}\s*(?:BCE|BC)?\s*(?:and|–|—|to|-)\s*\d{1,4}\s*(?:BCE|BC)\b/gi,
  /\b(?:early|late|mid[ -]?)\s*\d{1,2}(?:st|nd|rd|th)\s+century(?:\s+(?:BCE|BC))?\b/gi,
  /\b(?:circa|about|approximately|c\.)\s*\d{4}\s*\?/gi,
  new RegExp(`\\b(?:circa|about|approximately|c\\.)\\s+(?:\\d{1,2}(?:st|nd|rd|th)?\\s+)?(?:${monthPattern})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?\\d{4}(?:\\s*(?:BCE|BC))?\\b`,'gi'),
 ];
 for(const pattern of protectedHistorical)for(const match of text.matchAll(pattern))add(match.index,match.index+match[0].length,null,'Unsupported historical qualifier or bounds');
 // Historical expressions are recognized only when their full semantics are explicit.
 const historicalSuffix='(?:\\s*\\((Julian|Gregorian|Old Style|New Style)\\))?';
 const historicalPatterns=[
  new RegExp(`\\b(?:(?:between|from)\\s+)?(\\d{4})\\s*(?:and|–|—|to|-)\\s*(\\d{4})\\b${historicalSuffix}`,'gi'),
  new RegExp(`\\b(circa|about|approximately|c\\.)\\s*(\\d{4})\\b${historicalSuffix}`,'gi'),
  new RegExp(`\\b(?:(?:(\\d{1,2})\\s+)?(${monthPattern})\\s+)?(\\d{1,4})\\s*(?:BCE|BC)\\b${historicalSuffix}`,'gi'),
  new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)\\s+century(?:\\s+(BCE|BC))?\\b${historicalSuffix}`,'gi'),
 ];
 historicalPatterns.forEach((pattern,kind)=>{for(const match of text.matchAll(pattern)) {
  const calendar=/^(julian|old style)$/i.test(match.at(-1)??'')?'julian':'gregorian';
  let value:string;
  if(kind===0)value=`${match[1]}/${match[2]}`;
  else if(kind===1)value=`~${match[2]}`;
  else if(kind===2) {const month=match[2]?months.findIndex(name=>name.toLowerCase()===match[2]!.toLowerCase())+1:0;value=`-${match[3]!.padStart(4,'0')}${month?'-'+String(month).padStart(2,'0')+(match[1]?'-'+match[1].padStart(2,'0'):''):''}`;}
  else {const n=Number(match[1]),suffix=n%100>=11&&n%100<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[n%10]??'th';value=match[2]!.toLowerCase()===suffix?`C${match[3]?'-':''}${n}`:'';}
  const date=temporalDate(value,calendar);add(match.index,match.index+match[0].length,date,date?null:'Invalid historical expression');
 }});
 const unsupported=[
  /\b(?:between\s+\d{4}\s+and\s+\d{4}|(?:from\s+)?\d{4}\s*(?:–|—|-|to)\s*\d{4})\b/gi,
  /\b\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}\b/g,
  /\b(?:next|last|this)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|week|month|year)\b/gi,
  /\b(?:early\s+|late\s+|mid[ -])?(?:\w+(?:[ -]\w+)?|\d+(?:st|nd|rd|th))\s+century\b/gi,
  new RegExp(`\\b(?:(?:\\d{1,2}\\s+)?(?:${monthPattern})\\s+)?\\d{1,4}\\s*(?:BCE|BC)\\b`,'gi'),
  /\b(?:circa|about|approximately|c\.)\s*\d{4}\b/gi,
  new RegExp(`\\b(?:circa|about|approximately|c\\.)\\s+(?:\\d{1,2}(?:st|nd|rd|th)?\\s+)?(?:${monthPattern})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?\\d{4}\\b`,'gi'),
  new RegExp(`\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+)?(?:${monthPattern})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?\\d{4}\\s*\\?`,'gi'),
  new RegExp(`\\b(?:(?:\\d{1,2}(?:st|nd|rd|th)?\\s+)?(?:${monthPattern})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?)?\\d{4}\\s*\\((?:Hebrew|Hijri|Islamic|Buddhist|Chinese|French Republican|O\\.S\\.|N\\.S\\.)\\)`,'gi'),
 ];
 for(const pattern of unsupported)for(const match of text.matchAll(pattern))add(match.index,match.index+match[0].length,null,'Unsupported, ambiguous or approximate expression');
 const suffix='(?:\\s*\\((?:Old Style|New Style|Julian|Gregorian)\\))?';
 const pattern=new RegExp(`\\b(?:(\\d{1,3})(?:st|nd|rd|th)?\\s+(${monthPattern})\\s+(\\d{4})|(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})|(${monthPattern})\\s+(\\d{4}))\\b${suffix}`,'gi');
 for(const match of text.matchAll(pattern)) {
  const month=months.findIndex(name=>name.toLowerCase()===(match[2]??match[4]??match[7])!.toLowerCase())+1;
  const year=match[3]??match[6]??match[8]!,day=match[1]??match[5];
  const calendar=/\((?:Old Style|Julian)\)/i.test(match[0])?'julian':'gregorian';
  const value=`${year}-${String(month).padStart(2,'0')}${day?'-'+day.padStart(2,'0'):''}`;
  const ordinal=/\b(\d{1,2})(st|nd|rd|th)\b/i.exec(match[0]);
  const dayNumber=Number(day),expected=dayNumber%100>=11&&dayNumber%100<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[dayNumber%10]??'th';
  const date=ordinal&&ordinal[2]!.toLowerCase()!==expected?null:temporalDate(value,calendar);
  add(match.index,match.index+match[0].length,date,date?null:'Invalid civil date');
 }
 // A bare four-digit number needs year context, or must occupy the entire input.
 const yearPattern=new RegExp(`\\b(?:in|by|since|during|year|published)\\s+(\\d{4})\\b${suffix}|^\\s*(\\d{4})${suffix}\\s*$`,'gi');
 for(const match of text.matchAll(yearPattern)) {
  const value=match[1]??match[2]!,start=match.index+match[0].indexOf(value);
  const calendar=/\((?:Old Style|Julian)\)/i.test(match[0])?'julian':'gregorian';
  const date=temporalDate(value,calendar);add(start,match.index+match[0].trimEnd().length,date,date?null:'Invalid civil year');
 }
 return result.sort((a,b)=>a.start-b.start);
}

export function temporalOverlaps(date:TemporalDate,from:string,to:string):boolean {
 const lower=temporalDate(from,date.calendar),upper=temporalDate(to,date.calendar),bounds=temporalBounds(date),start=lower&&temporalBounds(lower),end=upper&&temporalBounds(upper);
 return !!(bounds&&start&&end&&bounds.from<=end.to&&bounds.to>=start.from);
}
