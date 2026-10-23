import {liturgicalCalendar,type LiturgicalDay,type LiturgicalCalendarId} from '../../shared/liturgical';
export function LiturgicalDayPanel({day,showOptional,calendarId='grc-en'}:{day:LiturgicalDay;showOptional:boolean;calendarId?:LiturgicalCalendarId}) {
 const alternatives=day.alternatives.filter(observance=>!observance.optional||showOptional);
 return <section className="calendar-liturgical-panel" aria-label="Liturgical calendar day"><p className="calendar-eyebrow">{liturgicalCalendar(calendarId)!.label}</p><h3>{day.principal.name}</h3><p>{[day.principal.rankName,day.principal.seasons.join(' / '),day.principal.colors.join(' / ')].filter(Boolean).join(' · ')}</p>
  {alternatives.map(observance=><div key={observance.id}><strong>{observance.name}</strong><small>{[observance.optional?'Optional observance':'Additional observance',observance.rankName,observance.seasons.join(' / '),observance.colors.join(' / ')].filter(Boolean).join(' · ')}</small></div>)}
 </section>;
}
