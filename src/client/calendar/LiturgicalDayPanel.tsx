import type {LiturgicalDay} from '../../shared/liturgical';
export function LiturgicalDayPanel({day,showOptional}:{day:LiturgicalDay;showOptional:boolean}) {
 const alternatives=day.alternatives.filter(observance=>!observance.optional||showOptional);
 return <section className="calendar-liturgical-panel" aria-label="General Roman Calendar day"><p className="calendar-eyebrow">GENERAL ROMAN CALENDAR</p><h3>{day.principal.name}</h3><p>{day.principal.rankName} · {day.principal.seasons.join(' / ')} · {day.principal.colors.join(' / ')||'No colour specified'}</p>
  {alternatives.map(observance=><div key={observance.id}><strong>{observance.name}</strong><small>{observance.optional?'Optional observance':'Additional observance'} · {observance.rankName} · {observance.seasons.join(' / ')} · {observance.colors.join(' / ')||'No colour specified'}</small></div>)}
 </section>;
}
