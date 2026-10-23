import {parseFragment} from 'parse5';
import {liturgicalCalendar,liturgicalKey,liturgicalSourceUrl,type LiturgicalCalendarId,type LiturgicalDay,type LiturgicalObservance,type LiturgicalYear} from '../../shared/liturgical.js';
import {temporalDate} from '../../shared/temporal.js';

export interface LiturgicalProvider {key:string;generate:(year:number,signal:AbortSignal)=>Promise<LiturgicalYear>}
type Row=Record<string,unknown>;
const row=(value:unknown):Row=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid calendar object');return value as Row;};
const list=(value:unknown):unknown[]=>{if(!Array.isArray(value)||value.length>2000)throw new Error('Invalid calendar list');return value;};
const text=(value:unknown,max=250)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('Invalid calendar text');return value.trim();};
const title=(value:string)=>value.toLowerCase().replace(/_/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());
const dayKey=(value:unknown,year:number)=>{const date=text(value,50).slice(0,10);if(temporalDate(date)?.precision!=='day')throw new Error('Invalid calendar date');return date.startsWith(`${year}-`)?date:null;};
function result(year:number,id:LiturgicalCalendarId,days:Record<string,LiturgicalDay>,version:string):LiturgicalYear {
 return {year,providerKey:liturgicalKey(id),providerVersion:version,dataVersion:liturgicalCalendar(id)!.label,generatedAt:new Date().toISOString(),days};
}
export function normalizeLitcal(input:unknown,year:number,id:LiturgicalCalendarId):LiturgicalYear {
 const data=row(input),settings=row(data.settings),metadata=row(data.metadata);
 if(settings.year!==year||settings.year_type!=='CIVIL'||settings.locale!==liturgicalCalendar(id)!.locale)throw new Error('Calendar request mismatch');
 const grouped=new Map<string,{grade:number;observance:LiturgicalObservance}[]>();
 const ranks=['WEEKDAY','COMMEMORATION','OPTIONAL_MEMORIAL','MEMORIAL','FEAST','FEAST_OF_THE_LORD','SOLEMNITY','HIGHER_SOLEMNITY'];
 for(const value of list(data.litcal)) {
  const entry=row(value);if(entry.is_vigil_mass===true)continue;
  const date=dayKey(entry.date,year);if(!date)continue;
  const grade=entry.grade;if(typeof grade!=='number'||!Number.isInteger(grade)||grade<0||grade>7)throw new Error('Invalid liturgical grade');
  const observance:LiturgicalObservance={id:text(entry.event_key,200),name:text(entry.name),rank:ranks[grade]!,rankName:typeof entry.grade_display==='string'&&entry.grade_display.trim()?text(entry.grade_display,80):text(entry.grade_lcl,80),seasons:[text(entry.liturgical_season_lcl??entry.liturgical_season,80)],colors:list(entry.color_lcl??entry.color).map(value=>title(text(value,80))),optional:grade===1||grade===2};
  const rows=grouped.get(date)??[];rows.push({grade,observance});grouped.set(date,rows);
 }
 const days:Record<string,LiturgicalDay>={};
 for(const [date,rows] of grouped) {
  // Optional memorials never displace the day's ordinary observance.
  const principal=rows.filter(item=>!item.observance.optional).sort((a,b)=>b.grade-a.grade)[0];
  // Coinciding memorials may both become optional; LitCal can omit the ferial
  // row on those days. Present a choice without inventing a weekday or feast.
  days[date]=principal?{principal:principal.observance,alternatives:rows.filter(item=>item!==principal).map(item=>item.observance)}:
   {principal:{id:`optional-observances-${date}`,name:id==='grc-la'?'Memoriae ad libitum':'Optional memorials (choice)',rank:'OPTIONAL_MEMORIAL',rankName:rows[0]!.observance.rankName,seasons:rows[0]!.observance.seasons,colors:[],optional:true},alternatives:rows.map(item=>item.observance)};
 }
 return result(year,id,days,text(metadata.version,100));
}
function plainHTML(value:unknown) {
 const fragment=parseFragment(text(value,2000));
 const collect=(node:{nodeName:string;value?:string;childNodes?:unknown[]}):string=>['script','style'].includes(node.nodeName)?'':node.value??(node.childNodes??[]).map(child=>collect(child as typeof node)).join('');
 return text(collect(fragment).replace(/\s+/g,' '));
}
export function normalizeOrdo(input:unknown,year:number):LiturgicalYear {
 const data=row(input);
 if(data.year!==year||data.lang!=='la'||data.source!=='ecclesia'||data.congregation!==''||data.mode!=='civil')throw new Error('Unexpected Vetus Ordo settings');
 const colors:Record<string,string>={albus:'White',ruber:'Red',viridis:'Green',violaceus:'Purple',roseus:'Rose',niger:'Black'};
 const normalize=(value:unknown,season:string,commemoration=false):LiturgicalObservance=>{
  const entry=row(value),rank=String(entry.rank);
  if(!['1','2','3','4','7'].includes(rank))throw new Error('Invalid 1962 rank');
  return {id:String(entry.id),name:plainHTML(entry.name),rank:commemoration?'COMMEMORATION':entry.kind==='feria'?'WEEKDAY':`CLASS_${rank}`,rankName:commemoration?'Commemoration':`Class ${rank}`,seasons:[title(season)],colors:entry.color?[colors[text(entry.color,80)]??title(text(entry.color,80))]:[],optional:false};
 };
 const days:Record<string,LiturgicalDay>={};
 for(const value of list(data.days)) {
  const entry=row(value),date=dayKey(entry.date,year);if(!date)continue;
  if(days[date])throw new Error('Duplicate calendar date');
  const season=text(entry.season,80);
  days[date]={principal:normalize(entry.celebration,season),alternatives:list(entry.commemorations).map(item=>normalize(item,season,true))};
 }
 return result(year,'vetus-ordo',days,'Ordo1962 API v1');
}
const unescapeICal=(value:string)=>value.replace(/\\([nN,;\\])/g,(_match,escaped:string)=>/[nN]/.test(escaped)?'\n':escaped);
export function normalizeGCatholic(input:string,year:number,id:LiturgicalCalendarId):LiturgicalYear {
 const calendar=liturgicalCalendar(id)!;
 if(!input.startsWith('BEGIN:VCALENDAR')||!input.includes('PRODID:-//GCatholic.org//'))throw new Error('Unexpected iCalendar provider');
 const events:Row[]=[],lines=input.replace(/\r?\n[ \t]/g,'').split(/\r?\n/);let event:Row|null=null;
 for(const line of lines) {
  if(line==='BEGIN:VEVENT'){if(event)throw new Error('Nested calendar event');event={};}
  else if(line==='END:VEVENT'){if(!event)throw new Error('Invalid calendar event');events.push(event);event=null;}
  else if(event){const separator=line.indexOf(':');if(separator>0)event[line.slice(0,separator)]=line.slice(separator+1);}
 }
 if(event||events.length>2000)throw new Error('Invalid iCalendar event bounds');
 const groups=new Map<string,{order:number;observance:LiturgicalObservance}[]>();
 const ranks:Record<string,[string,string]>={S:['SOLEMNITY','Solemnity'],F:['FEAST','Feast'],M:['MEMORIAL','Memorial'],m:['OPTIONAL_MEMORIAL','Optional memorial'],C:['COMMEMORATION','Commemoration'],c:['COMMEMORATION','Commemoration']};
 const colors:Record<string,string>={'⚪':'White','🟢':'Green','🔴':'Red','🟣':'Purple','🌸':'Rose','⚫':'Black','🔵':'Blue'};
 for(const entry of events) {
  const raw=text(entry['DTSTART;VALUE=DATE'],8);if(!/^\d{8}$/.test(raw))throw new Error('Expected all-day calendar event');
  const date=dayKey(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`,year);if(!date)continue;
  const uid=text(entry.UID,200),match=new RegExp(`^${year}-${calendar.locale}-${calendar.code}-\\d{4}-(\\d+)@gcatholic\\.org$`).exec(uid);
  if(!match)throw new Error('Unexpected national calendar identity');
  const summary=unescapeICal(text(entry.SUMMARY,1000)),color=Object.keys(colors).find(color=>summary.startsWith(color));
  const label=(color?summary.slice(color.length):summary).trim(),rank=/^\[([SFMmcC])\]\s*/.exec(label),mark=rank?.[1]??'';
  const sunday=new Date(`${date}T00:00:00Z`).getUTCDay()===0;
  const [rankCode,rankName]=ranks[mark]??(sunday?['SUNDAY','Sunday']:['WEEKDAY','Weekday']);
  const observance:LiturgicalObservance={id:uid,name:text(label.slice(rank?.[0].length??0)),rank:rankCode,rankName,seasons:[],colors:color?[colors[color]!]:[],optional:mark==='m'||mark==='c'};
  const group=groups.get(date)??[];group.push({order:Number(match[1]),observance});groups.set(date,group);
 }
 const days:Record<string,LiturgicalDay>={};
 for(const [date,group] of groups){group.sort((a,b)=>a.order-b.order);if(group[0]?.order!==1||group[0].observance.optional)throw new Error('Missing principal calendar event');days[date]={principal:group[0].observance,alternatives:group.slice(1).map(item=>item.observance)};}
 return result(year,id,days,'GCatholic iCalendar v3');
}
export function createLiturgicalProvider(id:LiturgicalCalendarId,fetcher:typeof fetch=fetch):LiturgicalProvider {
 return {key:liturgicalKey(id),async generate(year,signal){
  const response=await fetcher(liturgicalSourceUrl(id,year),{headers:{Accept:liturgicalCalendar(id)!.kind==='ical'?'text/calendar':'application/json','Accept-Language':liturgicalCalendar(id)!.locale.replace('_','-')},redirect:'error',signal});
  if(!response.ok||!response.body)throw new Error('Calendar download failed');
  const length=Number(response.headers.get('content-length'));if(length>8_000_000){await response.body.cancel();throw new Error('Calendar response too large');}
  const reader=response.body.getReader(),decoder=new TextDecoder();let source='',bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8_000_000)throw new Error('Calendar response too large');source+=decoder.decode(value,{stream:true});}source+=decoder.decode();}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const kind=liturgicalCalendar(id)!.kind;
  return kind==='ical'?normalizeGCatholic(source,year,id):kind==='ordo'?normalizeOrdo(JSON.parse(source),year):normalizeLitcal(JSON.parse(source),year,id);
 }};
}
