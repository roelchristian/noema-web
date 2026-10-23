import type {TemporalCuration,TemporalItem,TemporalLayer} from '../../shared/temporal';
export interface CalendarView {month:string;mode:'month'|'agenda';selected:string|null;layers:TemporalLayer[];allReferences:boolean;drafts:Record<string,TemporalCuration>}
export const dayValue=(date:Date)=>`${String(date.getUTCFullYear()).padStart(4,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
export function civilDate(value:string):Date {const [year,month=1,day=1]=value.split('-').map(Number);const date=new Date(0);date.setUTCFullYear(year!,month!-1,day);date.setUTCHours(0,0,0,0);return date;}
export function todayValue() {const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function monthBounds(month:string) {const start=civilDate(month);const end=civilDate(month);end.setUTCMonth(end.getUTCMonth()+1,0);return {from:dayValue(start),to:dayValue(end)};}
export function shiftMonth(month:string,delta:number) {const date=civilDate(month);date.setUTCMonth(date.getUTCMonth()+delta);return dayValue(date).slice(0,7);}
export function shiftDay(value:string,delta:number) {const date=civilDate(value);date.setUTCDate(date.getUTCDate()+delta);return dayValue(date);}
export function dateLabel(value:string) {return new Intl.DateTimeFormat('en',{timeZone:'UTC',year:'numeric',...(value.length>=7?{month:'long'}:{}),...(value.length===10?{day:'numeric'}:{})}).format(civilDate(value));}
export function monthCells(month:string,weekStart:0|1=0):(string|null)[][] {const {from,to}=monthBounds(month);const padding=(civilDate(from).getUTCDay()-weekStart+7)%7,days=Number(to.slice(-2)),cells=Array.from({length:Math.ceil((padding+days)/7)*7},(_,i)=>i<padding||i>=padding+days?null:`${month}-${String(i-padding+1).padStart(2,'0')}`);return Array.from({length:cells.length/7},(_,i)=>cells.slice(i*7,i*7+7));}
export function initialCalendarView():CalendarView {return {month:todayValue().slice(0,7),mode:'month',selected:null,layers:['personal','knowledge','historical'],allReferences:false,drafts:{}};}
export function calendarGroups(items:TemporalItem[]) {return {days:items.filter(item=>item.date.precision==='day'),periods:items.filter(item=>item.date.precision!=='day')};}
export const emptyCuration=():TemporalCuration=>({label:'',annotation:'',pinned:false,importance:'ordinary',personalPriority:'ordinary',layer:'knowledge'});
export const layerLabels:Record<TemporalLayer,string>={personal:'Personal',knowledge:'Knowledge',historical:'Historical'};

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
export function dateSummary(item:TemporalItem) {
 const references=item.mentionCount+(item.sourceCount??0)+(item.propertyCount??0),relationships=item.relationCount;
 return {title:item.curation?.label||item.relations[0]?.name||item.mentions[0]?.title||item.sources?.[0]?.title||item.properties?.[0]?.title||`${references} reference${references===1?'':'s'}`,
 references,relationships,total:references+relationships,counts:`${references} reference${references===1?'':'s'} · ${relationships} relationship${relationships===1?'':'s'}`};
}
