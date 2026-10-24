import type {ReactNode} from 'react';
import {temporalDisplay,type TemporalDate,type TemporalItem} from '../../shared/temporal';

/** Common identity and summary for every temporal entry point, independent of entities. */
export function DateOverview({date,item,compact=false,onOpenCalendar,children}:{date:TemporalDate;item?:TemporalItem|null;compact?:boolean;onOpenCalendar?:(date:TemporalDate)=>void;children?:ReactNode}) {
 const references=item?(item.mentionCount+(item.sourceCount??0)+(item.propertyCount??0)):null;
 return <section className={'date-overview'+(compact?' is-compact':'')} aria-label="Date overview" data-date-id={date.id}>
  <header><h2>{item?.curation?.label||temporalDisplay(date)}</h2><p>{temporalDisplay(date)} · {date.value.startsWith('~')?'Approximate '+date.precision:date.precision==='day'?'Exact day':date.precision} · {date.calendar==='julian'?'Julian':'Gregorian'}</p>
   {item&&<p>{item.relationCount} linked {item.relationCount===1?'item':'items'} · {references} reference {references===1?'occurrence':'occurrences'}</p>}
   {item?.curation?.annotation&&<p>{item.curation.annotation}</p>}
   {onOpenCalendar&&<button type="button" className="button" onClick={()=>onOpenCalendar(date)}>Open in Calendar</button>}
  </header>{children}
 </section>;
}
