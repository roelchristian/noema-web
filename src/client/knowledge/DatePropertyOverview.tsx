import {useContext} from 'react';
import {adaptTemporalProperty} from '../../shared/temporal-properties';
import {DateOverview} from './DateOverview';
import {DateNavigation} from './date-navigation';
export function DatePropertyOverview({type,name,value,declaredDate=false}:{type:string;name:string;value:string|null;declaredDate?:boolean}) {
 const open=useContext(DateNavigation),date=value===null?null:adaptTemporalProperty(type,name,value,declaredDate)?.date;
 if(!date)return null;
 return <details><summary>Date overview</summary><DateOverview date={date} compact onOpenCalendar={open}/></details>;
}
