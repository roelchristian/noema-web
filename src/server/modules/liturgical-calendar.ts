import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {liturgicalProviderKey,liturgicalProviderVersion,liturgicalDataVersion,supportedLiturgicalYear,validLiturgicalYear,type LiturgicalYear} from '../../shared/liturgical.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';

/** Isolated generator: no vault content, network, regional calendar, readings or
 * temporal entities. Resolve installed packages beside this server, not via cwd. */
const workerSource=`
 const {parentPort,workerData}=require('node:worker_threads');
 (async()=>{
  const core=await import(workerData.core);const {Romcal}=core.default??core;
  const bundle=await import(workerData.calendar);const {GeneralRoman_En}=bundle.default??bundle;
  const calendar=await new Romcal({localizedCalendar:GeneralRoman_En,scope:'gregorian',epiphanyOnSunday:false,ascensionOnSunday:false,corpusChristiOnSunday:false,temporalOverrides:{anchorExceptions:{}},outputOptions:{calculateProperties:true}}).generateCalendar(workerData.year);
  const label=value=>value.toLowerCase().split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join(' ');
  const normalize=row=>({id:row.id,name:row.name,rank:row.rank,rankName:row.rankName,seasons:row.seasons.map((season,i)=>row.seasonNames?.[i]||label(season)),colors:row.colors.map(label),optional:!!row.isOptional});
  const days={};let count=0;
  for(const [date,rows] of Object.entries(calendar)){
   if(!date.startsWith(workerData.year+'-'))continue;
   if(++count>366||!Array.isArray(rows)||!rows.length||rows.length>17)throw new Error('Unexpected provider output bounds');
   days[date]={principal:normalize(rows[0]),alternatives:rows.slice(1).map(normalize)};
  }
  parentPort.postMessage({days});
 })().catch(()=>{parentPort.postMessage({error:'Liturgical calendar generation failed'});});
`;
export interface LiturgicalProvider {key:string;generate:(year:number)=>Promise<LiturgicalYear>}
export class LiturgicalCalendar {
 private pending=new Map<number,Promise<LiturgicalYear>>();
 private serial:Promise<unknown>=Promise.resolve();
 private workers=new Set<Worker>();private closed=false;
 private provider:LiturgicalProvider;
 constructor(private store:Store,provider?:LiturgicalProvider) {this.provider=provider??{key:liturgicalProviderKey,generate:year=>this.generate(year)};}
 private generate(year:number):Promise<LiturgicalYear> {
  const require=createRequire(import.meta.url);
  return new Promise((resolve,reject)=>{
   const worker=new Worker(workerSource,{eval:true,execArgv:[],workerData:{year,core:pathToFileURL(require.resolve('romcal')).href,calendar:pathToFileURL(require.resolve('@romcal/calendar.general-roman')).href},resourceLimits:{maxOldGenerationSizeMb:128,stackSizeMb:4}});
   this.workers.add(worker);let settled=false;
   const finish=(error?:Error,data?:LiturgicalYear)=>{if(settled)return;settled=true;clearTimeout(timeout);this.workers.delete(worker);void worker.terminate();if(error)reject(error);else resolve(data!);};
   const timeout=setTimeout(()=>finish(new Error('Liturgical calendar generation timed out')),12000);
   worker.once('message',(result:{days?:LiturgicalYear['days'];error?:string})=>{if(result.error||!result.days)finish(new Error('Liturgical calendar generation failed'));else finish(undefined,{year,providerKey:liturgicalProviderKey,providerVersion:liturgicalProviderVersion,dataVersion:liturgicalDataVersion,generatedAt:new Date().toISOString(),days:result.days});});
   worker.once('error',()=>finish(new Error('Liturgical calendar worker failed')));
   worker.once('exit',()=>finish(new Error('Liturgical calendar worker stopped')));
  });
 }
 async year(vault:string,year:number):Promise<LiturgicalYear> {
  new Vaults(this.store).requireOpen(vault);
  if(!supportedLiturgicalYear(year))throw new HttpError(400,'General Roman Calendar supports civil years 1970–2099');
  const cached=this.store.get<{provider_key:string;data:string}>('SELECT provider_key,data FROM liturgical_year_cache WHERE year=?',year);
  if(cached?.provider_key===this.provider.key&&cached.data.length<=1_000_000)try {
   const value:unknown=JSON.parse(cached.data);if(validLiturgicalYear(value,year,this.provider.key)){this.store.run('UPDATE liturgical_year_cache SET last_access=? WHERE year=?',new Date().toISOString(),year);return value;}
  }catch{/* Corrupt/obsolete derived data is regenerated, never served as a feast list. */}
  let work=this.pending.get(year);
  if(!work) {
   if(this.pending.size>=2)throw new HttpError(429,'Two calendar years are already being prepared. Try again shortly.');
   work=this.serial.catch(()=>{}).then(async()=>{
    if(this.closed)throw new HttpError(503,'Calendar provider is closed');
    const result=await this.provider.generate(year);
    if(!validLiturgicalYear(result,year,this.provider.key)||JSON.stringify(result).length>1_000_000)throw new HttpError(503,'Liturgical calendar returned invalid data');
    const timestamp=new Date().toISOString();
    this.store.run('INSERT OR REPLACE INTO liturgical_year_cache VALUES (?,?,?,?,?)',year,this.provider.key,JSON.stringify(result),result.generatedAt,timestamp);
    this.store.run('DELETE FROM liturgical_year_cache WHERE year NOT IN (SELECT year FROM liturgical_year_cache ORDER BY last_access DESC,year DESC LIMIT 8)');
    return result;
   }).catch(error=>{throw error instanceof HttpError?error:new HttpError(503,'Liturgical calendar unavailable. The civil calendar is still usable.');}).finally(()=>this.pending.delete(year));
   this.pending.set(year,work);this.serial=work.then(()=>{},()=>{});
  }
  const result=await work;new Vaults(this.store).requireOpen(vault);return result;
 }
 close() {this.closed=true;for(const worker of this.workers)void worker.terminate();}
}
