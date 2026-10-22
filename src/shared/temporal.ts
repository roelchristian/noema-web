import type {SourceReference} from './domain.js';
import type {PageReference} from './embeddings.js';

export const temporalExtractorVersion='english-civil-v1';
export type TemporalPrecision='day'|'month'|'year';
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
export interface TemporalRelationSummary {id:string;entityId:string;mentionId:string|null;kind:string;origin:string;status:string;confidence:number|null;name:string;sourceMentionId?:string|null;propertyId?:string|null;version?:string;evidence:TemporalEvidence|TemporalSourceEvidence|TemporalPropertyEvidence|{status:'unresolved';reason:string}}
export interface TemporalItem {date:TemporalDate;curation:TemporalCuration|null;mentions:TemporalMentionSummary[];mentionCount:number;relations:TemporalRelationSummary[];relationCount:number;layer:TemporalLayer;sources?:TemporalSourceSummary[];sourceCount?:number;properties?:TemporalPropertySummary[];propertyCount?:number;proposals?:TemporalRelationSummary[];proposalCount?:number}
export interface TemporalResults {items:TemporalItem[];indexing:{refreshed:number;pending:number};nextOffset:number|null}
export interface TemporalDetail extends TemporalItem {nextMentionOffset:number|null;nextRelationOffset:number|null;nextSourceOffset?:number|null;nextPropertyOffset?:number|null;nextProposalOffset?:number|null}

const months='January February March April May June July August September October November December'.split(' ');
const monthPattern=months.join('|');
/** Identity retains precision. Boundaries used by range queries are never stored as invented days. */
export function temporalDate(value:string,calendar:TemporalCalendar='gregorian'):TemporalDate|null {
 if(calendar!=='gregorian'&&calendar!=='julian')return null;
 const match=/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
 if(!match)return null;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 if(year<1||year>9999||match[2]&&(month<1||month>12))return null;
 const leap=year%4===0&&(calendar==='julian'||year%100!==0||year%400===0);
 if(match[3]&&(day<1||day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1]!))return null;
 const precision=match[3]?'day':match[2]?'month':'year';
 return {id:`${calendar}:${precision}:${value}`,value,precision,calendar};
}

/** English civil expressions only. Unsupported expressions consume their full span so
 * neither an ambiguous numeric date nor a range leaks a fabricated inner year. */
export function extractTemporal(text:string):TemporalExpression[] {
 const result:TemporalExpression[]=[],occupied:{start:number;end:number}[]=[];
 const add=(start:number,end:number,date:TemporalDate|null,reason:string|null)=>{
  if(occupied.some(span=>start<span.end&&end>span.start))return;
  occupied.push({start,end});result.push({start,end,text:text.slice(start,end),date,reason});
 };
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
 const lower=date.value.length===4?date.value+'-01-01':date.value.length===7?date.value+'-01':date.value,upper=date.value.length===4?date.value+'-12-31':date.value.length===7?date.value+'-31':date.value;
 return lower<=to&&upper>=from;
}
