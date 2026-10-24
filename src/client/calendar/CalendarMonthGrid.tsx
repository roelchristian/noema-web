import type {KeyboardEvent} from 'react';
import type {TemporalCalendar,TemporalItem} from '../../shared/temporal';
import type {LiturgicalYear,LiturgicalCalendarId} from '../../shared/liturgical';
import {civilDate,civilRowWeek,dateLabel,dateSummary,dateAssociations,monthCells,todayValue} from './calendar-model';
import {liturgicalLabel,liturgicalRankLabel,monthLiturgicalLabel} from './liturgical-label';
import {liturgicalWeekLabel,liturgicalWeekSeasonColor} from './liturgical-week';
import {LiturgicalColorIndicator,principalLiturgicalColor} from './LiturgicalColorIndicator';

export function CalendarMonthGrid({month,selected,focusDay,weekStart,weekNumbers,optionalIndicators,items,liturgy,weekLiturgy=[],liturgicalLabels='off',calendarId,onFocus,onKey,onChoose,busy,includeReferences=false,civilCalendar='gregorian'}:{month:string;selected:string|null;focusDay:string;weekStart:0|1;weekNumbers:boolean;optionalIndicators:boolean;items:TemporalItem[];liturgy?:LiturgicalYear;weekLiturgy?:readonly (LiturgicalYear|null|undefined)[];liturgicalLabels?:'off'|'season'|'week';calendarId:LiturgicalCalendarId;onFocus:(date:string)=>void;onKey:(event:KeyboardEvent<HTMLButtonElement>,date:string)=>void;onChoose:(date:string,button:HTMLButtonElement,optional:boolean)=>void;busy:boolean;includeReferences?:boolean;civilCalendar?:TemporalCalendar}) {
 const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const weekdays=[...days.slice(weekStart),...days.slice(0,weekStart)];
 const columns=weekNumbers?8:7;
 const rangeFormat=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
 const byDate=new Map(items.map(item=>[item.date.value,item]));
 return <>
  {weekNumbers&&<p className="calendar-grid-help" id="calendar-week-help">{weekStart===0?'Sunday-based weeks · Week 1 contains 1 January.':civilCalendar==='julian'?'Monday-based Julian weeks · Week 1 contains 4 January.':'ISO weeks start Monday · Week 1 contains 4 January.'}</p>}
  <div role="grid" className={'calendar-grid'+(weekNumbers?' has-week-numbers':'')} aria-label={dateLabel(month)} aria-busy={busy} aria-describedby={'calendar-keyboard-help'+(weekNumbers?' calendar-week-help':'')}>
   <div role="row" className="calendar-weekdays">{weekNumbers&&<span role="columnheader" aria-label="Civil week">Wk</span>}{weekdays.map(day=><span role="columnheader" key={day}>{day}</span>)}</div>
   {monthCells(month,weekStart,civilCalendar).map((week,i)=>{
    const civil=civilRowWeek(month,i,weekStart,civilCalendar),range=civilCalendar==='julian'?dateLabel(civil.from,civilCalendar)+' – '+dateLabel(civil.to,civilCalendar):rangeFormat.formatRange(civilDate(civil.from),civilDate(civil.to));
    const label=liturgicalLabels==='off'?null:liturgicalWeekLabel(civil.from,civil.to,weekLiturgy,liturgicalLabels);
    const color=label?liturgicalWeekSeasonColor(civil.from,weekLiturgy):null;
    return <div role="rowgroup" key={i}>
    {weekNumbers&&<div role="row" className="calendar-civil-week-label"><span role="rowheader" aria-label={`Week ${civil.week}, ${civil.year}, ${range}`}>Week {civil.week}</span></div>}
    {label&&<div role="row" className="calendar-week-label"><span role="gridcell" aria-colspan={columns}>{color&&<LiturgicalColorIndicator colors={[color]}/>}<span>{weekNumbers&&`Week ${civil.week} · `}{label}</span><small>{range}</small></span></div>}
    <div role="row" className="calendar-week">{weekNumbers&&<span role="rowheader" className="calendar-week-number" aria-label={`Week ${civil.week}, ${civil.year}, ${range}`} title={`${civil.label} · ${range}`}>{civil.week}</span>}{week.map((value,j)=>{
     const item=value?byDate.get(value):undefined,summary=item?dateSummary(item):undefined,associations=item?dateAssociations(item,includeReferences):[],day=value&&liturgy?(liturgy.days[value]??weekLiturgy.find(year=>year?.days[value])?.days[value]):undefined,observance=day?.principal;
     const choices=optionalIndicators?day?.alternatives.filter(option=>option.optional)??[]:[];
     const optionalLabel=choices.length?`${choices.length} optional memorial${choices.length===1?'':'s'} available`:'';
     return <div role="gridcell" aria-selected={!!value&&selected===value} className={value?'calendar-cell'+(value.startsWith(month)?'':' is-outside-month'):'calendar-cell is-empty'} key={value??j}>{value&&<button type="button" data-date={value} tabIndex={focusDay===value?0:-1} aria-current={civilCalendar==='gregorian'&&value===todayValue()?'date':undefined}
      aria-label={[dateLabel(value,civilCalendar),summary?.title,item?.curation?.pinned?'Pinned':null,summary?.counts,observance?`${liturgicalLabel(observance.name,calendarId)}, ${liturgicalRankLabel(observance.rankName)}${observance.colors.length?', Liturgical color: '+observance.colors.join(' / '):''}`:null,optionalLabel].filter(Boolean).join(', ')}
      onFocus={()=>onFocus(value)} onKeyDown={event=>onKey(event,value)} onClick={event=>onChoose(value,event.currentTarget,!!choices.length)}>
      <span className="calendar-day-heading"><span className="calendar-day-number">{Number(value.slice(-2))}</span>{observance&&<LiturgicalColorIndicator colors={observance.colors}/>}</span>
      {summary&&<span className="calendar-cell-knowledge">{item?.curation?.pinned&&<svg className="calendar-pin" aria-label="Pinned" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m8 3 8 0-1 6 4 4H5l4-4-1-6ZM12 13v8"/></svg>}{associations.slice(0,2).map(entry=><span key={entry.id} className="calendar-cell-entry">{entry.title}</span>)}{associations.length>2&&<span className="calendar-more">+{associations.length-2} more</span>}{item&&(item.relationCount>item.relations.length||item.mentionCount>item.mentions.length||(item.sourceCount??0)>(item.sources?.length??0))&&<span className="calendar-more">More in date details</span>}<span className="calendar-cell-counts">{summary.counts}</span><span className="calendar-mobile-count" aria-hidden="true">{summary.relationships} links · {summary.references} refs</span></span>}

      {observance&&<span className="calendar-cell-supplement" aria-hidden="true"><span className="calendar-liturgical-cell" data-color={principalLiturgicalColor(observance.colors)}>{monthLiturgicalLabel(observance.name,calendarId)}</span><span className="calendar-liturgical-meta"><span className="calendar-liturgical-rank">{liturgicalRankLabel(observance.rankName)}</span>{!!choices.length&&<span className="calendar-optional-marker" title={optionalLabel}>+{choices.length}<span className="calendar-optional-text"> optional</span></span>}</span></span>}
     </button>}</div>;
    })}</div>
   </div>;})}
  </div>
  <p className="calendar-grid-help calendar-mobile-legend">Links count accepted relationships; refs count textual occurrences. Document counts deduplicate the loaded preview; + means more evidence remains. The pin marks a pinned date.{liturgy?' Colored markers show the principal liturgical color. + indicates available optional memorials; open the day for choices.':''}</p>
 </>;
}
