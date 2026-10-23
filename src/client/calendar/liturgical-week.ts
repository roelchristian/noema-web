import type {LiturgicalDay,LiturgicalObservance,LiturgicalYear} from '../../shared/liturgical';

type Season='Ordinary Time'|'Advent'|'Christmas'|'Lent'|'Easter'|'Easter Triduum';
const ordinal=(value:number)=>`${value}${value%100>=11&&value%100<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[value%10]??'th'}`;
const words=['first','second','third','fourth','fifth','sixth','seventh'];
const dayMs=86_400_000;
function dateValue(value:string):number|null {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const timestamp=Date.parse(`${value}T00:00:00Z`);
 return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value?timestamp:null;
}
function season(observance:LiturgicalObservance):Season|null {
 for(const raw of observance.seasons) {
  const normalized=raw.toLowerCase().replaceAll('_',' ');
  if(/triduum|triduo/.test(normalized))return 'Easter Triduum';
  if(/ordinary|ordinari|per annum/.test(normalized))return 'Ordinary Time';
  if(/advent/.test(normalized))return 'Advent';
  if(/christmas|nativita/.test(normalized))return 'Christmas';
  if(/lent|quadragesim/.test(normalized))return 'Lent';
  if(/easter|pasch/.test(normalized))return 'Easter';
 }
 // National iCalendar providers omit season metadata. Only temporal titles and
 // stable temporal IDs can supply it; a saint's feast color cannot.
 const {id,name}=observance;
 if(/^(HolyThurs|GoodFri|EasterVigil)$/.test(id))return 'Easter Triduum';
 if(/^(OrdSunday|OrdWeekday)\d+/.test(id)||/\b(?:Sunday|Week) (?:of|in) Ordinary Time\b/i.test(name))return 'Ordinary Time';
 if(/^Advent(?:\d|Weekday)/.test(id)||/\b(?:Sunday|Week) of Advent\b/i.test(name))return 'Advent';
 if(/^Lent(?:\d|Weekday)/.test(id)||/^(AshWednesday|(?:Thursday|Friday|Saturday)AfterAshWednesday|PalmSun|(?:Mon|Tue|Wed)HolyWeek)$/.test(id)||/\b(?:Sunday|Week) of Lent\b|\bHoly Week\b|^Ash Wednesday$/i.test(name))return 'Lent';
 if(/^(?:Easter(?:\d|Weekday)?|(?:Mon|Tue|Wed|Thu|Fri|Sat)OctaveEaster|Pentecost)$/.test(id)||/\b(?:Sunday|Week|Octave) of Easter\b|^Easter Sunday$/i.test(name))return 'Easter';
 if(/^Christmas/.test(id)||/\bChristmas (?:Weekday|Day)\b|^Christmas$/i.test(name))return 'Christmas';
 return null;
}
interface WeekDesignation {season:Season;label:string}
function designation(observance:LiturgicalObservance):WeekDesignation|null {
 const {id,name}=observance;
 const current=season(observance);
 if(!current)return null;
 if(current==='Easter'&&(/^(?:Easter|(?:Mon|Tue|Wed|Thu|Fri|Sat)OctaveEaster)$/.test(id)||/\bOctave of Easter\b|^Easter Sunday$/i.test(name)))return {season:current,label:'Easter Octave'};
 if(current==='Lent'&&(/^(?:PalmSun|(?:Mon|Tue|Wed)HolyWeek)$/.test(id)||/\bHoly Week\b|^Palm Sunday\b/i.test(name)))return {season:current,label:'Holy Week'};
 let number:number|null=null;
 const key=/^(OrdSunday|OrdWeekday|AdventWeekday|LentWeekday|EasterWeekday|Advent|Lent|Easter)(\d+)(?:[A-Za-z]+)?$/.exec(id);
 if(key)number=Number(key[2]);
 // Require the complete temporal construction, rather than harvesting an
 // arbitrary number from a feast title. This also handles regional providers.
 const temporal=/^(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) of the )?(\d+(?:st|nd|rd|th)|First|Second|Third|Fourth|Fifth|Sixth|Seventh) (?:Sunday|Week) (?:of|in) (Ordinary Time|Advent|Lent|Easter)(?:\b.*)?$/i.exec(name);
 if(number===null&&temporal)number=/^\d/.test(temporal[1]!)?parseInt(temporal[1]!,10):words.indexOf(temporal[1]!.toLowerCase())+1;
 const max=current==='Ordinary Time'?34:current==='Advent'?4:current==='Lent'?6:current==='Easter'?7:0;
 if(number===null||number<1||number>max)return null;
 return {season:current,label:`${ordinal(number)} Week ${current==='Ordinary Time'?'in':'of'} ${current}`};
}
function lookup(years:readonly (LiturgicalYear|null|undefined)[],date:string):LiturgicalDay|undefined {
 return years.find(year=>year?.days[date])?.days[date];
}
/** A civil row's caption is a derived view of independent liturgical days.
 * Missing dates or unknown seasons suppress the caption instead of guessing.
 * A Monday row uses evidence before its final Sunday for its week designation.
 */
export function liturgicalWeekLabel(start:string,end:string,years:readonly (LiturgicalYear|null|undefined)[],mode:'season'|'week'):string|null {
 const first=dateValue(start),last=dateValue(end);
 if(first===null||last===null||last<first||last-first>6*dayMs)return null;
 const entries:{date:number;day:LiturgicalDay;season:Season}[]=[];
 for(let date=first;date<=last;date+=dayMs) {
  const day=lookup(years,new Date(date).toISOString().slice(0,10));
  const current=day&&season(day.principal);
  if(!day||!current)return null;
  entries.push({date,day,season:current});
 }
 const seasons=entries.map(entry=>entry.season).filter((value,index,array)=>value!==array[index-1]);
 if(seasons.length>1)return seasons.join(' → ');
 const current=seasons[0]!;
 if(mode==='season')return current;
 for(const entry of entries) {
  if(entry.date>first&&new Date(entry.date).getUTCDay()===0)break;
  for(const observance of [entry.day.principal,...entry.day.alternatives]) {
   const week=designation(observance);
   if(week?.season===current)return week.label;
  }
 }
 return current;
}
/** Seasonal accent deliberately ignores a particular feast's liturgical color. */
export function liturgicalWeekSeasonColor(start:string,years:readonly (LiturgicalYear|null|undefined)[]):string|null {
 const day=lookup(years,start),current=day&&season(day.principal);
 return current?({'Ordinary Time':'green',Advent:'purple',Christmas:'white',Lent:'purple',Easter:'white','Easter Triduum':'white'} as const)[current]:null;
}
