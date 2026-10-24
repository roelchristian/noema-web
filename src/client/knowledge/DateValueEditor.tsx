import {useId,useState} from 'react';
import {adaptTemporalProperty} from '../../shared/temporal-properties';
import {temporalDate,temporalDisplay,type TemporalCalendar} from '../../shared/temporal';

/** Authored text stays authoritative. Structured controls commit only on an explicit action. */
export function DateValueEditor({label,value,disabled,onChange}:{label:string;value:string;disabled:boolean;onChange:(value:string)=>void}) {
 const hint=useId(),adapted=adaptTemporalProperty('','',value,true),date=adapted?.date;
 const [precision,setPrecision]=useState<'day'|'month'|'year'>(date?.precision==='month'?'month':date?.precision==='year'?'year':'day');
 const [calendar,setCalendar]=useState<TemporalCalendar>(date?.calendar??'gregorian');
 const [structured,setStructured]=useState(date?.value??'');
 const candidate=temporalDate(structured,calendar),valid=candidate?.precision===precision;
 return <div className="date-value-editor">
  <input autoFocus aria-label={label} aria-describedby={hint} type="text" disabled={disabled} value={value} placeholder="1815, June 1815, circa 1815" onChange={event=>onChange(event.target.value)}/>
  <small id={hint} role="status">{date?`${temporalDisplay(date)} · ${date.value.startsWith('~')?'approximate ':''}${date.precision} precision · ${date.calendar==='julian'?'Julian':'Gregorian'}`:value?'Original expression retained; interpretation is unresolved.':'Enter an original expression or choose a structured date.'}</small>
  <details><summary>Choose a structured date</summary><fieldset disabled={disabled} onKeyDown={event=>{if(event.key==='Enter'){event.stopPropagation();if(event.target instanceof HTMLInputElement)event.preventDefault();}}}>
   <label>Precision<select aria-label={label+' precision'} value={precision} onChange={event=>{setPrecision(event.target.value as typeof precision);setStructured('');}}><option value="day">Exact day</option><option value="month">Month</option><option value="year">Year</option></select></label>
   <label>Calendar<select aria-label={label+' calendar'} value={calendar} onChange={event=>setCalendar(event.target.value as TemporalCalendar)}><option value="gregorian">Gregorian</option><option value="julian">Julian</option></select></label>
   <label>{precision==='day'?'Date':precision==='month'?'Month (YYYY-MM)':'Year (YYYY)'}<input aria-label={label+' structured value'} type={precision==='day'&&calendar==='gregorian'?'date':'text'} placeholder={precision==='year'?'1815':precision==='month'?'1815-06':'1815-06-18'} value={structured} onChange={event=>setStructured(event.target.value)}/></label>
   <button type="button" className="button" disabled={!valid} onClick={()=>onChange(structured+(calendar==='julian'?' (Julian)':''))}>Use this date</button>
   <small>Choosing a date replaces the expression only when you press Use this date. Original precision and calendar notation are preserved. No missing month or day is supplied.</small>
  </fieldset></details>
 </div>;
}
