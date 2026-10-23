import type {KeyboardEvent} from 'react';
import type {TemporalItem} from '../../shared/temporal';
import type {LiturgicalYear,LiturgicalCalendarId} from '../../shared/liturgical';
import {dateLabel,dateSummary,isoRowWeek,monthCells,todayValue} from './calendar-model';
import {liturgicalLabel,liturgicalRankLabel,monthLiturgicalLabel} from './liturgical-label';
import {LiturgicalColorIndicator} from './LiturgicalColorIndicator';

export function CalendarMonthGrid({month,selected,focusDay,weekStart,weekNumbers,optionalIndicators,items,liturgy,calendarId,onFocus,onKey,onChoose,busy}:{month:string;selected:string|null;focusDay:string;weekStart:0|1;weekNumbers:boolean;optionalIndicators:boolean;items:TemporalItem[];liturgy?:LiturgicalYear;calendarId:LiturgicalCalendarId;onFocus:(date:string)=>void;onKey:(event:KeyboardEvent<HTMLButtonElement>,date:string)=>void;onChoose:(date:string,button:HTMLButtonElement,optional:boolean)=>void;busy:boolean}) {
 const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const weekdays=[...days.slice(weekStart),...days.slice(0,weekStart)];
 const byDate=new Map(items.map(item=>[item.date.value,item]));
 return <>
  {weekNumbers&&<p className="calendar-grid-help" id="calendar-iso-help">Row labels use Monday’s ISO week and week-year.{weekStart===0?' Sunday belongs to the preceding ISO week.':''}</p>}
  <div role="grid" className="calendar-grid" aria-label={dateLabel(month)} aria-busy={busy} aria-describedby={'calendar-keyboard-help'+(weekNumbers?' calendar-iso-help':'')}>
   <div role="row" className="calendar-weekdays">{weekdays.map(day=><span role="columnheader" key={day}>{day}</span>)}</div>
   {monthCells(month,weekStart).map((week,i)=><div role="rowgroup" key={i}>
    {weekNumbers&&<div role="row" className="calendar-week-label"><span role="rowheader" aria-colspan={7}>{isoRowWeek(month,i,weekStart).label} · Monday’s ISO week</span></div>}
    <div role="row" className="calendar-week">{week.map((value,j)=>{
     const item=value?byDate.get(value):undefined,summary=item?dateSummary(item):undefined,day=value?liturgy?.days[value]:undefined,observance=day?.principal;
     const choices=optionalIndicators?day?.alternatives.filter(option=>option.optional)??[]:[];
     const optionalLabel=choices.length?`${choices.length} optional memorial${choices.length===1?'':'s'} available`:'';
     return <div role="gridcell" aria-selected={!!value&&selected===value} className={value?'calendar-cell':'calendar-cell is-empty'} key={value??j}>{value&&<button type="button" data-date={value} tabIndex={focusDay===value?0:-1} aria-current={value===todayValue()?'date':undefined}
      aria-label={[dateLabel(value),summary?.title,item?.curation?.pinned?'Pinned':null,summary?.counts,observance?`${liturgicalLabel(observance.name,calendarId)}, ${liturgicalRankLabel(observance.rankName)}${observance.colors.length?', Liturgical color: '+observance.colors.join(' / '):''}`:null,optionalLabel].filter(Boolean).join(', ')}
      onFocus={()=>onFocus(value)} onKeyDown={event=>onKey(event,value)} onClick={event=>onChoose(value,event.currentTarget,!!choices.length)}>
      <span className="calendar-day-heading"><span className="calendar-day-number">{Number(value.slice(-2))}</span>{observance&&<LiturgicalColorIndicator colors={observance.colors}/>}</span>
      {summary&&<span className="calendar-cell-knowledge"><span className="calendar-cell-entry">{item?.curation?.pinned?'Pinned · ':''}{summary.title}</span><span className="calendar-cell-counts">{summary.counts}</span><span className="calendar-mobile-count" aria-hidden="true">{item?.curation?.pinned?'P · ':''}{summary.total}</span></span>}
      {observance&&<span className="calendar-cell-supplement" aria-hidden="true"><span className="calendar-liturgical-cell">{monthLiturgicalLabel(observance.name,calendarId)}</span><span className="calendar-liturgical-rank">{liturgicalRankLabel(observance.rankName)}</span></span>}
      {!!choices.length&&<span className="calendar-optional-marker" aria-hidden="true" title={optionalLabel}>+<span className="calendar-optional-text"> {choices.length} optional</span></span>}
     </button>}</div>;
    })}</div>
   </div>)}
  </div>
  <p className="calendar-grid-help calendar-mobile-legend">Numbers below saved dates count reference occurrences and accepted relationships. P means pinned.{liturgy?' Colored markers show the principal liturgical color. + indicates available optional memorials; open the day for choices.':''}</p>
 </>;
}
