import {extractTemporal,temporalDate,type TemporalDate} from './temporal.js';
const fields:Record<string,Record<string,string>>={person:{'birth date':'born_on'},event:{'start date':'occurs_on','end date':'discusses'},creativework:{'release date':'published_on'},source:{'publication date':'published_on','accessed date':'discusses'}};
export function temporalPropertyKind(type:string,name:string):string|undefined {return fields[type]?.[name.toLowerCase()];}
/** Compatible read adapter. The authored property is never rewritten. ISO is explicit
 * in a typed date field; numeric locale dates still require the user's interpretation. */
export function adaptTemporalProperty(type:string,name:string,raw:string):{date:TemporalDate|null;kind:string;reason:string|null}|null {
 const kind=temporalPropertyKind(type,name);if(!kind)return null;
 const value=raw.trim(),iso=temporalDate(value);
 if(iso)return {date:iso,kind,reason:null};
 const expressions=extractTemporal(value),expression=expressions[0];
 if(expressions.length===1&&expression?.date&&expression.start===0&&expression.end===value.length)return {date:expression.date,kind,reason:null};
 return {date:null,kind,reason:expression?.reason??'The complete property value is not an unambiguous supported date'};
}
