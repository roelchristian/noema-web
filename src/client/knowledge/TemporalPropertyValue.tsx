import {adaptTemporalProperty} from '../../shared/temporal-properties';
export function TemporalPropertyValue({type,name,value}:{type:string;name:string;value:string|null}) {
 const adapted=value===null?null:adaptTemporalProperty(type,name,value);
 return <>{value}{adapted&&<small className="temporal-property-status">{adapted.date?`${adapted.date.precision[0]!.toUpperCase()+adapted.date.precision.slice(1)} precision · ${adapted.date.calendar==='julian'?'Julian':'Gregorian'}`:`Unresolved date · ${adapted.reason}`}</small>}</>;
}
