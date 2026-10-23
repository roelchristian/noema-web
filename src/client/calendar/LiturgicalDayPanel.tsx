import {liturgicalCalendar,type LiturgicalDay,type LiturgicalCalendarId} from '../../shared/liturgical';
import {Icon} from '../components/Icon';
export function LiturgicalDayPanel({day,showOptional,calendarId='grc-en'}:{day:LiturgicalDay;showOptional:boolean;calendarId?:LiturgicalCalendarId}) {
 const alternatives=day.alternatives.filter(observance=>!observance.optional||showOptional);
 return <section className="calendar-liturgical-panel" aria-label="Liturgical calendar day"><div className="knowledge-section-heading"><h3><Icon name="event"/>{liturgicalCalendar(calendarId)!.label}</h3></div><h4 className="calendar-observance-title">{day.principal.name}</h4><p className="calendar-muted">{[day.principal.rankName,day.principal.seasons.join(' / '),day.principal.colors.join(' / ')].filter(Boolean).join(' · ')}</p>
  {alternatives.map(observance=><div className="calendar-observance" key={observance.id}><h4 className="calendar-observance-title">{observance.name}</h4><small>{[observance.optional?'Optional observance':'Additional observance',observance.rankName,observance.seasons.join(' / '),observance.colors.join(' / ')].filter(Boolean).join(' · ')}</small></div>)}
 </section>;
}
