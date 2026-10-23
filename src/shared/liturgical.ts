export const liturgicalCalendars=[
 {id:'grc-en',label:'General Roman Calendar · English',provider:'LitCal v5',kind:'litcal',locale:'en_US',code:'',minYear:1970,maxYear:9999},
 {id:'grc-la',label:'General Roman Calendar · Latin',provider:'LitCal v5',kind:'litcal',locale:'la',code:'',minYear:1970,maxYear:9999},
 {id:'vetus-ordo',label:'Vetus Ordo · 1962 · Latin',provider:'Ordo1962',kind:'ordo',locale:'la',code:'',minYear:1962,maxYear:2099},
 {id:'us',label:'United States · English',provider:'GCatholic',kind:'ical',locale:'en',code:'US-H',minYear:1970,maxYear:2099},
 {id:'ph',label:'Philippines · English',provider:'GCatholic',kind:'ical',locale:'en',code:'PH',minYear:1970,maxYear:2099},
 {id:'mx',label:'Mexico · English',provider:'GCatholic',kind:'ical',locale:'en',code:'MX',minYear:1970,maxYear:2099},
 {id:'fr',label:'France · English',provider:'GCatholic',kind:'ical',locale:'en',code:'FR',minYear:1970,maxYear:2099},
 {id:'de',label:'Germany · English',provider:'GCatholic',kind:'ical',locale:'en',code:'DE',minYear:1970,maxYear:2099},
] as const;
export type LiturgicalCalendarId=typeof liturgicalCalendars[number]['id'];
export function liturgicalCalendar(id:string) {return liturgicalCalendars.find(calendar=>calendar.id===id);}
export function liturgicalKey(id:LiturgicalCalendarId) {const item=liturgicalCalendar(id)!;return `${item.provider}|${id}|civil|${item.locale}|adapter-v2`;}
export const liturgicalMinYear=1970,liturgicalMaxYear=9999;
export const liturgicalProviderVersion='v5';
export const liturgicalDataVersion='LitCal General Roman Calendar';
export const liturgicalProviderKey=liturgicalKey('grc-en');
export function liturgicalSourceUrl(id:LiturgicalCalendarId,year:number) {
 const item=liturgicalCalendar(id)!;
 return item.kind==='litcal'?`https://litcal.johnromanodorazio.com/api/v5/calendar/${year}?locale=${item.locale}&year_type=CIVIL&epiphany=JAN6&ascension=THURSDAY&corpus_christi=THURSDAY`:item.kind==='ordo'?`https://ordo.fsspx.org/api/v1/calendar/${year}?lang=la&source=ecclesia&congregation=&mode=civil`:`https://gcatholic.org/calendar/ics/${year}-${item.locale}-${item.code}.ics?v=3`;
}
export function liturgicalReferenceUrl(id:LiturgicalCalendarId,year:number) {
 const item=liturgicalCalendar(id)!;
 return item.kind==='ordo'?`https://ordo.fsspx.org/?year=${year}&lang=la&source=ecclesia&congregation=`:`https://gcatholic.org/calendar/${year}/${item.kind==='litcal'?'General-A':item.code}-${item.kind==='litcal'?(id==='grc-la'?'la':'en'):item.locale}`;
}
export interface LiturgicalDownloadStatus {ready:number;queued:number;failed:number;total:number;years:number[];calendars:{id:LiturgicalCalendarId;ready:number;queued:number;failed:number}[]}
export interface LiturgicalObservance {id:string;name:string;rank:string;rankName:string;seasons:string[];colors:string[];optional:boolean}
export interface LiturgicalDay {principal:LiturgicalObservance;alternatives:LiturgicalObservance[]}
export interface LiturgicalYear {year:number;providerKey:string;providerVersion:string;dataVersion:string;generatedAt:string;days:Record<string,LiturgicalDay>}
export function supportedLiturgicalYear(year:number,id:LiturgicalCalendarId='grc-en') {const item=liturgicalCalendar(id);return !!item&&Number.isInteger(year)&&year>=item.minYear&&year<=item.maxYear;}
/** Bounded, serializable provider contract shared by the server and offline cache.
 * This validates output, not the liturgical rules; precedence belongs to the provider. */
export function validLiturgicalYear(value:unknown,year:number,key=liturgicalProviderKey):value is LiturgicalYear {
 if(!Number.isInteger(year)||year<1962||year>9999||!value||typeof value!=='object')return false;
 const data=value as LiturgicalYear;
 const string=(v:unknown,max=250)=>typeof v==='string'&&v.length>0&&v.length<=max;
 const strings=(v:unknown,empty=false)=>Array.isArray(v)&&(empty||v.length>0)&&v.length<=4&&v.every(item=>string(item,80));
 const observance=(v:unknown)=>{if(!v||typeof v!=='object')return false;const o=v as LiturgicalObservance;return string(o.id,200)&&string(o.name)&&string(o.rank,64)&&string(o.rankName,80)&&strings(o.seasons,true)&&strings(o.colors,true)&&typeof o.optional==='boolean';};
 if(data.year!==year||data.providerKey!==key||!string(data.providerVersion,100)||!string(data.dataVersion,150)||!string(data.generatedAt,40)||!Number.isFinite(Date.parse(data.generatedAt))||!data.days||typeof data.days!=='object')return false;
 const dates:string[]=[];for(let date=new Date(Date.UTC(year,0,1));date.getUTCFullYear()===year;date.setUTCDate(date.getUTCDate()+1))dates.push(date.toISOString().slice(0,10));
 if(Object.keys(data.days).length!==dates.length)return false;
 return dates.every(date=>{const day=data.days[date];return day&&observance(day.principal)&&Array.isArray(day.alternatives)&&day.alternatives.length<=16&&day.alternatives.every(observance);});
}
