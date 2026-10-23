import {liturgicalCalendars,liturgicalCalendar,liturgicalKey,supportedLiturgicalYear,validLiturgicalYear,type LiturgicalCalendarId,type LiturgicalYear,type LiturgicalDownloadStatus} from '../../shared/liturgical.js';
import {createLiturgicalProvider,type LiturgicalProvider} from './liturgical-providers.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';
export type {LiturgicalProvider} from './liturgical-providers.js';

type CacheRow={provider_key:string;data:string};
/** Public calendar downloads contain only calendar identity and year. Vault evidence
 * controls eligibility, but note text, entity names and vault IDs stay local. */
export class LiturgicalCalendar {
 private pending=new Map<string,Promise<LiturgicalYear>>();
 private serial:Promise<unknown>=Promise.resolve();
 private controllers=new Set<AbortController>();private closed=false;private ticking=false;
 constructor(private store:Store,private provider:(id:LiturgicalCalendarId)=>LiturgicalProvider=createLiturgicalProvider,private now:()=>Date=()=>new Date()) {}
 private open(vault:string){new Vaults(this.store).requireOpen(vault);}
 private id(value:string):LiturgicalCalendarId{const calendar=liturgicalCalendar(value);if(!calendar)throw new HttpError(400,'Unsupported liturgical calendar');return calendar.id;}
 private years(vault:string):number[] {
  const rows=this.store.all<{year:number}>(`SELECT year FROM liturgical_seed_years UNION
   SELECT CAST(substr(d.value,1,4) AS INTEGER) AS year FROM temporal_dates d
   WHERE d.vault_id=? AND (EXISTS(SELECT 1 FROM temporal_curation c WHERE c.vault_id=d.vault_id AND c.id=d.id)
    OR EXISTS(SELECT 1 FROM temporal_relations r JOIN entities e ON e.id=r.entity_id AND e.vault_id=r.vault_id WHERE r.vault_id=d.vault_id AND r.date_id=d.id AND r.status='accepted' AND e.archived_at IS NULL)) ORDER BY year`,vault);
  return rows.map(row=>row.year);
 }
 private targets(vault:string){return this.years(vault).flatMap(year=>liturgicalCalendars.filter(calendar=>supportedLiturgicalYear(year,calendar.id)).map(calendar=>({id:calendar.id,year})));}
 private cached(id:LiturgicalCalendarId,year:number,key:string):LiturgicalYear|null {
  const cached=this.store.get<CacheRow>('SELECT provider_key,data FROM liturgical_calendar_cache WHERE calendar_id=? AND year=?',id,year);
  if(cached?.provider_key===key&&cached.data.length<=1_000_000)try{const data:unknown=JSON.parse(cached.data);if(validLiturgicalYear(data,year,key))return data;}catch{/* Re-download invalid derived data. */}
  return null;
 }
 /** Called at app launch. Seed a rolling three-year window; later expansion comes
  * only from explicit curation or an accepted relationship, never browsing. */
 prepare(vault:string,currentYear:number,retry=false):LiturgicalDownloadStatus {
  this.open(vault);
  if(!Number.isInteger(currentYear)||Math.abs(currentYear-this.now().getFullYear())>1)throw new HttpError(400,'Choose the current civil year');
  for(const year of [currentYear,currentYear-1,currentYear+1])if(year>=1962&&year<=9999)this.store.run('INSERT OR IGNORE INTO liturgical_seed_years VALUES (?)',year);
  this.store.run("INSERT OR REPLACE INTO metadata VALUES ('liturgical-current-year',?)",String(currentYear));
  this.plan(vault);
  if(retry)for(const {id,year} of this.targets(vault))this.store.run("UPDATE liturgical_calendar_downloads SET status='queued',attempts=0,next_attempt=0 WHERE calendar_id=? AND year=? AND status='failed'",id,year);
  return this.status(vault);
 }
 private plan(vault:string) {
  for(const {id,year} of this.targets(vault)) {
   const key=this.provider(id).key;
   const saved=this.store.get<{provider_key:string}>('SELECT provider_key FROM liturgical_calendar_cache WHERE calendar_id=? AND year=?',id,year);
   if(saved?.provider_key!==key)this.store.run("INSERT OR IGNORE INTO liturgical_calendar_downloads VALUES (?,?,'queued',0,0)",id,year);
  }
 }
 status(vault:string):LiturgicalDownloadStatus {
  this.open(vault);
  const calendars=liturgicalCalendars.map(calendar=>({id:calendar.id,ready:0,queued:0,failed:0}));
  for(const {id,year} of this.targets(vault)) {
   const summary=calendars.find(item=>item.id===id)!;
   const cached=this.store.get<{provider_key:string}>('SELECT provider_key FROM liturgical_calendar_cache WHERE calendar_id=? AND year=?',id,year);
   const job=this.store.get<{status:string}>('SELECT status FROM liturgical_calendar_downloads WHERE calendar_id=? AND year=?',id,year);
   if(cached?.provider_key===this.provider(id).key)summary.ready++;else if(job?.status==='failed')summary.failed++;else summary.queued++;
  }
  const ready=calendars.reduce((n,item)=>n+item.ready,0),queued=calendars.reduce((n,item)=>n+item.queued,0),failed=calendars.reduce((n,item)=>n+item.failed,0);
  return {ready,queued,failed,total:ready+queued+failed,years:this.years(vault),calendars};
 }
 async year(vault:string,year:number,calendarId:string='grc-en'):Promise<LiturgicalYear> {
  this.open(vault);const id=this.id(calendarId),calendar=liturgicalCalendar(id)!;
  if(!supportedLiturgicalYear(year,id))throw new HttpError(400,`${calendar.label} supports ${calendar.minYear}–${calendar.maxYear}`);
  if(!this.store.get('SELECT 1 FROM liturgical_seed_years LIMIT 1'))this.prepare(vault,this.now().getFullYear());
  const provider=this.provider(id),cached=this.cached(id,year,provider.key);
  if(cached){this.store.run('UPDATE liturgical_calendar_cache SET last_access=? WHERE calendar_id=? AND year=?',this.now().toISOString(),id,year);return cached;}
  if(!this.years(vault).includes(year))throw new HttpError(409,'This year has no curated dates or accepted date relationships. Browsing does not download additional calendars.');
  return this.download(vault,id,year,provider);
 }
 private async download(vault:string,id:LiturgicalCalendarId,year:number,provider:LiturgicalProvider):Promise<LiturgicalYear> {
  const key=`${id}:${year}`;let work=this.pending.get(key);
  if(!work) {
   if(this.pending.size>=2)throw new HttpError(429,'Two calendar years are already being downloaded. Try again shortly.');
   work=this.serial.catch(()=>{}).then(async()=>{
    if(this.closed)throw new HttpError(503,'Calendar provider is closed');
    this.open(vault);
    // A queued request must still qualify when its network work begins.
    if(!this.years(vault).includes(year))throw new HttpError(409,'Calendar year no longer qualifies for download');
    const controller=new AbortController();this.controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),25000);
    try {
     const result=await provider.generate(year,controller.signal);
     if(this.closed||controller.signal.aborted)throw new Error('Calendar download cancelled');
     this.open(vault);
     if(!validLiturgicalYear(result,year,provider.key)||JSON.stringify(result).length>1_000_000)throw new Error('Invalid liturgical calendar data');
     this.store.run('INSERT OR REPLACE INTO liturgical_calendar_cache VALUES (?,?,?,?,?,?)',id,year,provider.key,JSON.stringify(result),result.generatedAt,this.now().toISOString());
     this.store.run('DELETE FROM liturgical_calendar_downloads WHERE calendar_id=? AND year=?',id,year);
     return result;
    }finally{clearTimeout(timeout);this.controllers.delete(controller);}
   }).catch(error=>{throw error instanceof HttpError?error:new HttpError(503,'Liturgical calendar unavailable. Saved calendars and civil dates remain usable.');}).finally(()=>this.pending.delete(key));
   this.pending.set(key,work);this.serial=work.then(()=>{},()=>{});
  }
  const result=await work;this.open(vault);return result;
 }
 /** One bounded background download at a time; failures back off and survive restart. */
 async tick() {
  if(this.closed||this.ticking||!this.store.get('SELECT 1 FROM liturgical_seed_years LIMIT 1'))return;
  this.ticking=true;
  try {
   const vaults=this.store.all<{id:string}>('SELECT id FROM vaults WHERE locked=0');
   const eligible=new Map<string,string>();
   for(const vault of vaults){this.plan(vault.id);for(const target of this.targets(vault.id))eligible.set(`${target.id}:${target.year}`,vault.id);}
   const current=Number(this.store.get<{value:string}>("SELECT value FROM metadata WHERE key='liturgical-current-year'")?.value??this.now().getFullYear());
   const jobs=this.store.all<{calendar_id:LiturgicalCalendarId;year:number;attempts:number}>("SELECT * FROM liturgical_calendar_downloads WHERE next_attempt<=? AND attempts<3 ORDER BY abs(year-?),year DESC,calendar_id LIMIT 100",this.now().getTime(),current);
   for(const job of jobs) {
    const vault=eligible.get(`${job.calendar_id}:${job.year}`);
    if(!vault){this.store.run('DELETE FROM liturgical_calendar_downloads WHERE calendar_id=? AND year=?',job.calendar_id,job.year);continue;}
    if(this.pending.size>=2)break;
    try{await this.year(vault,job.year,job.calendar_id);}
    catch{if(!this.closed)this.store.run("UPDATE liturgical_calendar_downloads SET status='failed',attempts=attempts+1,next_attempt=? WHERE calendar_id=? AND year=?",this.now().getTime()+60_000*5**job.attempts,job.calendar_id,job.year);}
    break;
   }
  }finally{this.ticking=false;}
 }
 close(){this.closed=true;for(const controller of this.controllers)controller.abort();}
}
