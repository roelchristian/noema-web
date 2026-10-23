import {useLayoutEffect,useRef,useState} from 'react';
import {positionAnchoredMenu} from '../components/menu-placement';
import {dateLabel} from './calendar-model';

export function CalendarMonthJump({month,onChange}:{month:string;onChange:(month:string)=>void}) {
 const [open,setOpen]=useState(false),[year,setYear]=useState(''),[selectedMonth,setMonth]=useState(''),[error,setError]=useState('');
 const trigger=useRef<HTMLButtonElement>(null),form=useRef<HTMLFormElement>(null);
 useLayoutEffect(()=>{if(!open||!form.current||!trigger.current)return;const node=form.current;node.showPopover();const position=()=>positionAnchoredMenu(node,trigger.current!,{align:'end',minWidth:280});position();node.querySelector('select')?.focus();window.addEventListener('resize',position);window.addEventListener('scroll',position,true);return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);};},[open]);
 function close(){setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}
 return <div className="calendar-month-jump"><button type="button" className="button" ref={trigger} aria-expanded={open} aria-controls="calendar-jump-form" onClick={()=>{setYear(String(Number(month.slice(0,4))));setMonth(month.slice(5));setError('');setOpen(value=>!value);}}>Go to month</button>
 {open&&<form ref={form} popover="auto" onToggle={event=>{if(!event.currentTarget.matches(':popover-open'))setOpen(false);}} id="calendar-jump-form" className="calendar-jump-form" noValidate onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}} onSubmit={event=>{event.preventDefault();if(!/^\d{1,4}$/.test(year)||Number(year)<1||Number(year)>9999){setError('Enter a year from 1 to 9999.');return;}onChange(`${year.padStart(4,'0')}-${selectedMonth}`);close();}}>
 <label htmlFor="calendar-jump-month">Month</label><select id="calendar-jump-month" autoFocus value={selectedMonth} onChange={event=>setMonth(event.target.value)}>{Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(value=><option key={value} value={value}>{dateLabel('2000-'+value).replace(' 2000','')}</option>)}</select>
 <label htmlFor="calendar-jump-year">Year</label><input id="calendar-jump-year" inputMode="numeric" value={year} aria-invalid={!!error} aria-describedby={error?'calendar-jump-error':undefined} onChange={event=>setYear(event.target.value)}/>
 {error&&<p role="alert" id="calendar-jump-error">{error}</p>}<div><button type="submit" className="button">Go</button><button type="button" className="button" onClick={close}>Cancel</button></div>
 </form>}
 </div>;
}
