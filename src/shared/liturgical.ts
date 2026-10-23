export const liturgicalMinYear=1970,liturgicalMaxYear=2099;
export const liturgicalProviderVersion='3.0.0-dev.140';
export const liturgicalDataVersion='@romcal/calendar.general-roman@3.0.0-dev.140';
export const liturgicalProviderKey=`romcal@${liturgicalProviderVersion}|${liturgicalDataVersion}|en|universal-fixed-transfers|adapter-v1`;
export interface LiturgicalObservance {id:string;name:string;rank:string;rankName:string;seasons:string[];colors:string[];optional:boolean}
export interface LiturgicalDay {principal:LiturgicalObservance;alternatives:LiturgicalObservance[]}
export interface LiturgicalYear {year:number;providerKey:string;providerVersion:string;dataVersion:string;generatedAt:string;days:Record<string,LiturgicalDay>}
export function supportedLiturgicalYear(year:number) {return Number.isInteger(year)&&year>=liturgicalMinYear&&year<=liturgicalMaxYear;}
/** Bounded, serializable provider contract shared by the server and offline cache.
 * This validates output, not the liturgical rules; precedence belongs to the provider. */
export function validLiturgicalYear(value:unknown,year:number,key=liturgicalProviderKey):value is LiturgicalYear {
 if(!supportedLiturgicalYear(year)||!value||typeof value!=='object')return false;
 const data=value as LiturgicalYear;
 const string=(v:unknown,max=250)=>typeof v==='string'&&v.length>0&&v.length<=max;
 const strings=(v:unknown,empty=false)=>Array.isArray(v)&&(empty||v.length>0)&&v.length<=4&&v.every(item=>string(item,80));
 const observance=(v:unknown)=>{if(!v||typeof v!=='object')return false;const o=v as LiturgicalObservance;return string(o.id,200)&&string(o.name)&&string(o.rank,64)&&string(o.rankName,80)&&strings(o.seasons)&&strings(o.colors,true)&&typeof o.optional==='boolean';};
 if(data.year!==year||data.providerKey!==key||!string(data.providerVersion,100)||!string(data.dataVersion,150)||!string(data.generatedAt,40)||!Number.isFinite(Date.parse(data.generatedAt))||!data.days||typeof data.days!=='object')return false;
 const dates:string[]=[];for(let date=new Date(Date.UTC(year,0,1));date.getUTCFullYear()===year;date.setUTCDate(date.getUTCDate()+1))dates.push(date.toISOString().slice(0,10));
 if(Object.keys(data.days).length!==dates.length)return false;
 return dates.every(date=>{const day=data.days[date];return day&&observance(day.principal)&&Array.isArray(day.alternatives)&&day.alternatives.length<=16&&day.alternatives.every(observance);});
}
