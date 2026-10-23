import {useState} from 'react';
import {liturgicalLabel,liturgicalRankLabel} from './liturgical-label';
import {liturgicalCalendar,type LiturgicalDay,type LiturgicalCalendarId} from '../../shared/liturgical';
import {Icon} from '../components/Icon';
export function LiturgicalDayPanel({day,showOptional,calendarId='grc-en'}:{day:LiturgicalDay;showOptional:boolean;calendarId?:LiturgicalCalendarId}) {
 const [choicesOpen,setChoicesOpen]=useState(false);
 const optional=day.alternatives.filter(observance=>observance.optional);
 const alternatives=day.alternatives.filter(observance=>!observance.optional||showOptional);
 return <section className="calendar-liturgical-panel" aria-label="Liturgical calendar day"><p className="calendar-supplement-heading">Liturgical supplement</p><div className="knowledge-section-heading"><h3><Icon name="event"/>{liturgicalCalendar(calendarId)!.label}</h3></div><h4 className="calendar-observance-title">{liturgicalLabel(day.principal.name,calendarId)}</h4><p className="calendar-muted">{[liturgicalRankLabel(day.principal.rankName),day.principal.seasons.join(' / '),day.principal.colors.join(' / ')].filter(Boolean).join(' · ')}</p>
  {alternatives.map(observance=><div className="calendar-observance" key={observance.id}><h4 className="calendar-observance-title">{liturgicalLabel(observance.name,calendarId)}</h4><small>{[observance.optional?'Optional observance':'Additional observance',liturgicalRankLabel(observance.rankName),observance.seasons.join(' / '),observance.colors.join(' / ')].filter(Boolean).join(' · ')}</small></div>)}
  {!showOptional&&optional.length>0&&<details className="calendar-optional-choices" onToggle={event=>setChoicesOpen(event.currentTarget.open)}><summary>{optional.length} optional memorial{optional.length===1?'':'s'} available</summary>{choicesOpen&&optional.map(observance=><div className="calendar-observance" key={observance.id}><h4 className="calendar-observance-title">{liturgicalLabel(observance.name,calendarId)}</h4><small>Optional observance · {liturgicalRankLabel(observance.rankName)}</small></div>)}</details>}
 </section>;
}
