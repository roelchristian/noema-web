import type {TemporalCuration,TemporalItem,TemporalLayer} from '../../shared/temporal';
export interface CalendarView {month:string;mode:'month'|'agenda';selected:string|null;layers:TemporalLayer[];allReferences:boolean;drafts:Record<string,TemporalCuration>}
export const dayValue=(date:Date)=>`${String(date.getUTCFullYear()).padStart(4,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
export function civilDate(value:string):Date {const [year,month=1,day=1]=value.split('-').map(Number);const date=new Date(0);date.setUTCFullYear(year!,month!-1,day);date.setUTCHours(0,0,0,0);return date;}
export function todayValue() {const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function monthBounds(month:string) {const start=civilDate(month);const end=civilDate(month);end.setUTCMonth(end.getUTCMonth()+1,0);return {from:dayValue(start),to:dayValue(end)};}
export function shiftMonth(month:string,delta:number) {const date=civilDate(month);date.setUTCMonth(date.getUTCMonth()+delta);return dayValue(date).slice(0,7);}
export function shiftDay(value:string,delta:number) {const date=civilDate(value);date.setUTCDate(date.getUTCDate()+delta);return dayValue(date);}
export function dateLabel(value:string) {return new Intl.DateTimeFormat('en',{timeZone:'UTC',year:'numeric',...(value.length>=7?{month:'long'}:{}),...(value.length===10?{day:'numeric'}:{})}).format(civilDate(value));}
export function monthCells(month:string):(string|null)[][] {const {from,to}=monthBounds(month);const padding=(civilDate(from).getUTCDay()+6)%7,days=Number(to.slice(-2)),cells=Array.from({length:Math.ceil((padding+days)/7)*7},(_,i)=>i<padding||i>=padding+days?null:`${month}-${String(i-padding+1).padStart(2,'0')}`);return Array.from({length:cells.length/7},(_,i)=>cells.slice(i*7,i*7+7));}
export function initialCalendarView():CalendarView {return {month:todayValue().slice(0,7),mode:'month',selected:null,layers:['personal','knowledge','historical'],allReferences:false,drafts:{}};}
export function calendarGroups(items:TemporalItem[]) {return {days:items.filter(item=>item.date.precision==='day'),periods:items.filter(item=>item.date.precision!=='day')};}
export const emptyCuration=():TemporalCuration=>({label:'',annotation:'',pinned:false,importance:'ordinary',personalPriority:'ordinary',layer:'knowledge'});
export const layerLabels:Record<TemporalLayer,string>={personal:'Personal',knowledge:'Knowledge',historical:'Historical'};
