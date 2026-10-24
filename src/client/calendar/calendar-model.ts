import type {TemporalCuration,TemporalItem,TemporalLayer} from '../../shared/temporal';
export interface CalendarView {month:string;mode:'month'|'agenda';selected:string|null;selectedId?:string|null;calendar?:'gregorian'|'julian';contentFilter?:'curated'|'linked'|'all';layers:TemporalLayer[];allReferences:boolean;drafts:Record<string,TemporalCuration>}
export const dayValue=(date:Date)=>`${String(date.getUTCFullYear()).padStart(4,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
export function civilDate(value:string):Date {const [year,month=1,day=1]=value.split('-').map(Number);const date=new Date(0);date.setUTCFullYear(year!,month!-1,day);date.setUTCHours(0,0,0,0);return date;}
export function todayValue() {const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function monthBounds(month:string) {const start=civilDate(month);const end=civilDate(month);end.setUTCMonth(end.getUTCMonth()+1,0);return {from:dayValue(start),to:dayValue(end)};}
export function shiftMonth(month:string,delta:number) {const date=civilDate(month);date.setUTCMonth(date.getUTCMonth()+delta);return dayValue(date).slice(0,7);}
export function shiftDay(value:string,delta:number) {const date=civilDate(value);date.setUTCDate(date.getUTCDate()+delta);return dayValue(date);}
export function dateLabel(value:string) {return new Intl.DateTimeFormat('en',{timeZone:'UTC',year:'numeric',...(value.length>=7?{month:'long'}:{}),...(value.length===10?{day:'numeric'}:{})}).format(civilDate(value));}
export function monthCells(month:string,weekStart:0|1=0):(string|null)[][] {const {from,to}=monthBounds(month);const padding=(civilDate(from).getUTCDay()-weekStart+7)%7,days=Number(to.slice(-2)),cells=Array.from({length:Math.ceil((padding+days)/7)*7},(_,i)=>{const date=civilDate(from);date.setUTCDate(date.getUTCDate()+i-padding);return date.getUTCFullYear()<1||date.getUTCFullYear()>9999?null:dayValue(date);});return Array.from({length:cells.length/7},(_,i)=>cells.slice(i*7,i*7+7));}
export function initialCalendarView():CalendarView {return {month:todayValue().slice(0,7),mode:'month',selected:null,layers:['personal','knowledge','historical'],allReferences:false,drafts:{}};}
export function calendarGroups(items:TemporalItem[]) {return {days:items.filter(item=>item.date.precision==='day'),periods:items.filter(item=>item.date.precision!=='day')};}
export const emptyCuration=():TemporalCuration=>({label:'',annotation:'',pinned:false,importance:'ordinary',personalPriority:'ordinary',layer:'knowledge'});
export const layerLabels:Record<TemporalLayer,string>={personal:'Personal',knowledge:'Knowledge',historical:'Historical'};

/** Civil numbering follows CLDR rules: Sunday/one day or Monday/four days (ISO). */
export interface CivilWeek {year:number;week:number;weekStart:0|1;from:string;to:string;label:string}
function firstCivilWeek(year:number,weekStart:0|1) {
 const anchor=civilDate(`${String(year).padStart(4,'0')}-01-${weekStart===0?'01':'04'}`);
 anchor.setUTCDate(anchor.getUTCDate()-(anchor.getUTCDay()-weekStart+7)%7);
 return anchor;
}
export function civilWeek(value:string,weekStart:0|1=0):CivilWeek {
 const date=civilDate(value),from=new Date(date);
 from.setUTCDate(from.getUTCDate()-(from.getUTCDay()-weekStart+7)%7);
 let year=date.getUTCFullYear(),first=firstCivilWeek(year,weekStart);
 if(from<first){year--;first=firstCivilWeek(year,weekStart);}
 else if(from>=firstCivilWeek(year+1,weekStart)){year++;first=firstCivilWeek(year,weekStart);}
 const week=1+Math.round((from.getTime()-first.getTime())/604800000),to=new Date(from);
 to.setUTCDate(to.getUTCDate()+6);
 return {year,week,weekStart,from:dayValue(from),to:dayValue(to),label:`${String(year).padStart(4,'0')}-W${String(week).padStart(2,'0')}`};
}
/** Includes the complete row range, even when a month has leading or trailing blanks. */
export function civilRowWeek(month:string,row:number,weekStart:0|1=0):CivilWeek {
 const first=monthBounds(month).from,padding=(civilDate(first).getUTCDay()-weekStart+7)%7;
 return civilWeek(shiftDay(first,row*7-padding),weekStart);
}

/** ISO labels always refer to Monday, even when a display row begins on Sunday. */
export function isoRowWeek(month:string,row:number,weekStart:0|1=0) {
 const first=monthBounds(month).from,padding=(civilDate(first).getUTCDay()-weekStart+7)%7;
 const monday=civilDate(first);monday.setUTCDate(monday.getUTCDate()-padding+row*7+(weekStart===0?1:0));
 const thursday=new Date(monday);thursday.setUTCDate(thursday.getUTCDate()+3);
 const year=thursday.getUTCFullYear(),jan4=civilDate(`${String(year).padStart(4,'0')}-01-04`);
 jan4.setUTCDate(jan4.getUTCDate()-(jan4.getUTCDay()+6)%7);
 const week=1+Math.round((monday.getTime()-jan4.getTime())/604800000);
 return {year,week,label:`${String(year).padStart(4,'0')}-W${String(week).padStart(2,'0')}`};
}
export interface CalendarAssociation {id:string;title:string;description:string;kind:'curation'|'event'|'property'|'reference';entityId?:string;mentionId?:string;sourceId?:string}
/** Distinct associations in a stable order; evidence occurrences remain separate counts. */
export function dateAssociations(item:TemporalItem,includeReferences=true):CalendarAssociation[] {
 const entries:CalendarAssociation[]=[];
 if(item.curation)entries.push({id:'curation',title:item.curation.label||'Date note',description:item.curation.annotation||'Curated date',kind:'curation'});
 const relations=[...item.relations].sort((a,b)=>Number(b.kind==='occurs_on')-Number(a.kind==='occurs_on')||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 const linked=new Set<string>();
 for(const relation of relations){const key=relation.entityId+':'+relation.kind;if(linked.has(key))continue;linked.add(key);entries.push({id:relation.id,title:relation.name,description:relation.kind.replaceAll('_',' '),kind:relation.propertyId?'property':'event',entityId:relation.entityId});}
 if(includeReferences)for(const property of [...(item.properties??[])].sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id))){if(item.relations.some(relation=>relation.propertyId===property.id))continue;entries.push({id:property.id,title:property.title,description:`${property.name}: ${property.raw}`,kind:'property',entityId:property.entityId});}
 if(includeReferences){const documents=new Set<string>();
  for(const mention of [...item.mentions].sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id))){const key='page:'+mention.pageId;if(documents.has(key))continue;documents.add(key);entries.push({id:mention.id,title:mention.title||'Untitled page',description:mention.text,kind:'reference',mentionId:mention.id});}
  for(const source of [...(item.sources??[])].sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id))){const key='source:'+source.sourceId;if(documents.has(key))continue;documents.add(key);entries.push({id:source.id,title:source.title,description:source.text,kind:'reference',sourceId:source.id});}
 }
 return entries;
}
export function dateSummary(item:TemporalItem) {
 const references=item.mentionCount+(item.sourceCount??0),relationships=item.relationCount;
 const documents=new Set([...item.mentions.map(mention=>'page:'+mention.pageId),...(item.sources??[]).map(source=>'source:'+source.sourceId)]).size;
 const partial=item.mentionCount>item.mentions.length||(item.sourceCount??0)>(item.sources?.length??0);
 return {title:dateAssociations(item)[0]?.title||'Date',references,relationships,total:references+relationships,
 counts:`${documents}${partial?'+':''} document${documents===1?'':'s'} · ${references} occurrence${references===1?'':'s'} · ${relationships} linked item${relationships===1?'':'s'}`};
}
