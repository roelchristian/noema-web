import {useEffect,useState} from 'react';
import type {Vault} from '../../shared/domain';
import {liturgicalCalendars,liturgicalSourceUrl,liturgicalReferenceUrl,type LiturgicalDownloadStatus,type LiturgicalCalendarId} from '../../shared/liturgical';
import {api} from '../api';
import {Select} from '../components/Select';
import {t as uiText} from '../i18n';
import type {CalendarSettings as Preferences} from './calendar-settings';

export function CalendarSettings({value,onChange,vault,storageError}:{value:Preferences;onChange:(value:Preferences)=>void;vault:Vault|null;storageError:boolean}) {
 const [status,setStatus]=useState<LiturgicalDownloadStatus|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{
  setStatus(null);setError('');if(!vault||vault.locked)return;
  const controller=new AbortController();let reading=false;
  const read=async()=>{if(reading||document.hidden||controller.signal.aborted)return;reading=true;try{const result=await api.liturgicalStatus(vault.id,controller.signal);if(!controller.signal.aborted){setStatus(result);setError('');}}catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));}finally{reading=false;}};
  void read();const timer=setInterval(()=>{void read();},5000);return()=>{controller.abort();clearInterval(timer);};
 },[vault?.id,vault?.locked,version]);
 const retry=async()=>{if(!vault)return;setBusy(true);setError('');try{await api.prepareLiturgical(vault.id,new Date().getFullYear(),true);setVersion(value=>value+1);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
 return <>
  <section className="settings-section" aria-labelledby="calendar-settings-heading"><h3 id="calendar-settings-heading">{uiText('Liturgical calendars')}</h3>
   <label className="calendar-check"><input type="checkbox" checked={value.enabled} onChange={event=>onChange({...value,enabled:event.target.checked})}/>{uiText('Show a liturgical calendar')}</label>
   <label className="calendar-check"><input type="checkbox" checked={value.optional} onChange={event=>onChange({...value,optional:event.target.checked})}/>{uiText('Optional memorial detail')}</label>
   <p className="section-hint">{uiText('Liturgical dates and observances appear alongside your saved dates. Calendar sources and downloads are managed automatically.')}</p>
   <p role="status">{uiText(storageError?'Browser storage unavailable. Calendar preferences will not persist after reload.':'Changes saved in this browser.')}</p>
  </section>
  <section className="settings-section" aria-labelledby="calendar-layout-heading"><h3 id="calendar-layout-heading">Month view</h3>
   <div className="calendar-field"><label htmlFor="settings-week-start">Start week on</label><Select id="settings-week-start" value={value.weekStart??0} onChange={event=>onChange({...value,weekStart:Number(event.target.value) as 0|1})}><option value={0}>Sunday</option><option value={1}>Monday</option></Select></div>
   <label className="calendar-check"><input type="checkbox" checked={value.weekNumbers===true} onChange={event=>onChange({...value,weekNumbers:event.target.checked})}/>Show ISO week numbers</label>
   <p className="section-hint">ISO weeks start Monday. Each row is labelled with its Monday’s ISO week and week-year; in Sunday-first rows, Sunday belongs to the preceding ISO week.</p>
   <label className="calendar-check"><input type="checkbox" checked={value.optionalIndicators!==false} onChange={event=>onChange({...value,optionalIndicators:event.target.checked})}/>Indicate available optional memorials</label>
   <p className="section-hint">Only choices supplied by the selected calendar are indicated. They do not replace the principal observance.</p>
  </section>
  <details className="settings-advanced calendar-advanced-settings"><summary>{uiText('Advanced calendar settings')}</summary>
  <section className="settings-section" aria-labelledby="calendar-variant-heading"><h3 id="calendar-variant-heading">{uiText('Calendar tradition and region')}</h3>
   <div className="calendar-field"><label htmlFor="settings-liturgical-calendar">{uiText('Calendar')}</label><Select id="settings-liturgical-calendar" value={value.calendarId} onChange={event=>onChange({...value,calendarId:event.target.value as LiturgicalCalendarId})}>{liturgicalCalendars.map(calendar=><option key={calendar.id} value={calendar.id}>{calendar.label}</option>)}</Select></div>
   <p className="section-hint">{uiText('Vetus Ordo uses the Roman Missal of 1962. National calendars include their proper observances and transfers.')}</p>
  </section>
  <section className="settings-section" aria-labelledby="calendar-downloads-heading"><h3 id="calendar-downloads-heading">{uiText('Downloaded calendars')}</h3>
   <p>{uiText('At launch, all supported calendars are prepared for the current year, the year before and the year after. Additional years require a curated date or an accepted date relationship. Browsing and incidental date mentions do not trigger downloads.')}</p>
   {!vault||vault.locked?<p>{uiText('Open a vault to prepare calendars.')}</p>:<>
    {status&&<p role="status">{status.ready} / {status.total} {uiText('calendar years ready')} · {status.queued} {uiText('queued')} · {status.failed} {uiText('failed')}</p>}
    {error&&<p role="alert">{error}</p>}
    <ul className="calendar-provider-list">{liturgicalCalendars.map(calendar=>{
     const counts=status?.calendars.find(item=>item.id===calendar.id);
     return <li key={calendar.id}><strong>{calendar.label}</strong><span>{calendar.provider}{counts?` · ${counts.ready} ${uiText('ready')}${counts.failed?` · ${counts.failed} ${uiText('failed')}`:''}`:''}</span><span><a href={liturgicalSourceUrl(calendar.id,new Date().getFullYear())} target="_blank" rel="noopener noreferrer">{uiText('Calendar data')}</a> · <a href={liturgicalReferenceUrl(calendar.id,new Date().getFullYear())} target="_blank" rel="noopener noreferrer">{uiText('Calendar reference')}</a></span></li>;
    })}</ul>
    <button type="button" className="button" disabled={busy} onClick={()=>void retry()}>{uiText(busy?'Preparing calendars…':'Retry calendar downloads')}</button>
   </>}
  </section>
  </details>
 </>;
}
