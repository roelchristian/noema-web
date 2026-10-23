import type {TemporalDate} from '../../shared/temporal';
import type {CalendarSettings} from '../settings/calendar-settings';
import {useLiturgicalYear} from '../calendar/use-liturgical-year';
import {LiturgicalDayPanel} from '../calendar/LiturgicalDayPanel';
import {Icon} from '../components/Icon';
import {t as uiText} from '../i18n';

/** Use the same selected calendar, cache and download eligibility as Calendar.
 * A coarse or Julian date never acquires an invented Gregorian observance. */
export function DateLiturgicalDetails({vaultId,date,settings,onOpenSettings}:{vaultId:string;date:TemporalDate;settings:CalendarSettings;onOpenSettings?:()=>void}) {
 const exact=date.precision==='day'&&date.calendar==='gregorian';
 const year=Number(date.value.slice(0,4));
 const result=useLiturgicalYear(vaultId,year,settings.enabled&&exact,settings.calendarId);
 const day=result.data?.days[date.value];
 return <section className="eh-section note-date-liturgical" aria-label={uiText('Liturgical calendar details')}>
  <div className="knowledge-section-heading"><h3>{uiText('Liturgical calendar')}</h3>{onOpenSettings&&<button type="button" className="page-tool" aria-label={uiText('Calendar settings')} title={uiText('Calendar settings')} onClick={onOpenSettings}><Icon name="settings"/></button>}</div>
  {!settings.enabled?<p className="section-hint">{uiText('Enable a liturgical calendar in Settings → Calendar to show its observances here.')}</p>:
   !exact?<p className="section-hint">{uiText(date.calendar==='julian'?'Liturgical observances use Gregorian civil days. This Julian date has not been converted.':'Liturgical observances require an exact day. This date retains its original precision.')}</p>:<>
    {result.loading&&<p role="status">{uiText('Loading liturgical calendar…')}</p>}
    {result.error&&<div role="status"><p>{result.error}</p><button type="button" className="button" onClick={result.retry}>{uiText('Retry liturgical calendar')}</button></div>}
    {day&&<LiturgicalDayPanel day={day} calendarId={settings.calendarId} showOptional={settings.optional}/>}
   </>}
 </section>;
}
