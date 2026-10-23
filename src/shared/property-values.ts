import type {Entity, Property} from './domain.js';
import type {PropertyDefinition} from './property-definitions.js';
import {adaptTemporalProperty} from './temporal-properties.js';
import {temporalDate,extractTemporal} from './temporal.js';

export type PropertyCompatibility = 'valid'|'legacy_incompatible'|'unresolved'|'unknown';
/** Derived, indexable mirrors. Authored strings and reference IDs stay in properties. */
export interface PropertyValueMetadata {
 definition_id:string; compatibility:PropertyCompatibility; reason:string|null;
 integer_value:number|null; decimal_value:number|null; boolean_value:number|null; text_value:string|null;
 latitude:number|null; longitude:number|null; unit:string|null; position:number;
 target_id:string|null; temporal_date_id:string|null;
}
function classifyBasePropertyValue(definition:PropertyDefinition, property:Pick<Property,'name'|'value'|'target_id'>, target?:Pick<Entity,'type'|'subtypes'|'vault_id'>):PropertyValueMetadata {
 const result:PropertyValueMetadata={definition_id:definition.id,compatibility:'valid',reason:null,integer_value:null,decimal_value:null,boolean_value:null,text_value:null,latitude:null,longitude:null,unit:null,position:0,target_id:null,temporal_date_id:null};
 const incompatible=(reason:string)=>({...result,compatibility:'legacy_incompatible' as const,reason});
 if(property.target_id!==null) {
  if(!target)return incompatible('The referenced entity is unavailable.');
  if(definition.valueKind!=='entity_reference')return incompatible('This definition expects a scalar value.');
  if(definition.allowedTargetTypes.length&&!definition.allowedTargetTypes.includes(target.type))return incompatible('The referenced entity has an incompatible type.');
  if(definition.allowedTargetSubtypes.length&&!definition.allowedTargetSubtypes.some(id=>target.subtypes.includes(id)))return incompatible('The referenced entity lacks a permitted subtype.');
  result.target_id=property.target_id;return result;
 }
 const raw=property.value??'';
 if(definition.valueKind==='entity_reference')return {...result,compatibility:'unresolved',reason:'Literal awaiting deliberate entity resolution.',text_value:raw};
 if(definition.valueKind==='short_text'||definition.valueKind==='long_text'||definition.valueKind==='identifier'){result.text_value=raw;return result;}
 if(definition.valueKind==='url') {
  try {const url=new URL(raw);if(!['http:','https:'].includes(url.protocol))return incompatible('Use an HTTP or HTTPS URL.');}catch{return incompatible('Use an HTTP or HTTPS URL.');}
  result.text_value=raw;return result;
 }
 if(definition.valueKind==='integer') {
  if(!/^[+-]?\d+$/.test(raw.trim())||!Number.isSafeInteger(Number(raw)))return incompatible('Use a safe whole number.');
  result.integer_value=Number(raw);return result;
 }
 if(definition.valueKind==='quantity') {
  const match=/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s+(.+))?$/.exec(raw.trim());
  if(!match||!Number.isFinite(Number(match[1])))return incompatible('Use a finite number, optionally followed by a unit.');
  result.decimal_value=Number(match[1]);result.unit=match[2]??null;return result;
 }
 if(definition.valueKind==='boolean') {
  if(raw==='unknown')return {...result,compatibility:'unknown',reason:'Explicitly unknown.'};
  if(raw!=='true'&&raw!=='false')return incompatible('Use true, false, or unknown.');
  result.boolean_value=raw==='true'?1:0;return result;
 }
 if(definition.valueKind==='enum') {
  const choices=definition.validation.values;
  if(!Array.isArray(choices)||!choices.includes(raw))return incompatible('Choose one of the declared values.');
  result.text_value=raw;return result;
 }
 if(definition.valueKind==='coordinates') {
  const match=/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/.exec(raw);
  if(!match||Math.abs(Number(match[1]))>90||Math.abs(Number(match[2]))>180)return incompatible('Use latitude, longitude within -90…90 and -180…180.');
  result.latitude=Number(match[1]);result.longitude=Number(match[2]);return result;
 }
 if(definition.valueKind==='date') {
  const adapted=adaptTemporalProperty(definition.scope.type,property.name,raw);
  const date=adapted?.date??(adapted===null?temporalDate(raw.trim()):null);
  if(!date) {
   const expressions=adapted===null?extractTemporal(raw.trim()):[],expression=expressions.length===1?expressions[0]:undefined;
   const reason=adapted?.reason??(expression?.start===0&&expression.end===raw.trim().length?expression.reason:null);
   if(reason==='Unsupported, ambiguous or approximate expression')return {...result,compatibility:'unresolved',reason};
   return incompatible(reason??'Preserved date requires temporal review; no precision was assumed.');
  }
  // Canonical identity is resolved against the existing temporal subsystem by storage.
  return result;
 }
 if(definition.valueKind==='datetime') {
  const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(raw);
  if(!match||!temporalDate(match[1]!)||Number(match[2])>23||Number(match[3])>59||Number(match[4]??0)>59||Number(match[5]??0)>23||Number(match[6]??0)>59||!Number.isFinite(Date.parse(raw)))return incompatible('Use a valid ISO date-time with an explicit time-zone offset.');
  result.text_value=raw;return result;
 }
 return incompatible('Unsupported value kind; the original value is retained.');
}
/** Apply declared scalar constraints to both legacy review and typed writes. */
export function classifyPropertyValue(definition:PropertyDefinition, property:Pick<Property,'name'|'value'|'target_id'>, target?:Pick<Entity,'type'|'subtypes'|'vault_id'>):PropertyValueMetadata {
 const result=classifyBasePropertyValue(definition,property,target);
 if(result.compatibility!=='valid'||property.target_id!==null)return result;
 const constraints=definition.validation,raw=property.value??'';
 let reason:string|null=null;
 if(typeof constraints.minLength==='number'&&raw.length<constraints.minLength)reason='Value is shorter than the declared minimum.';
 if(typeof constraints.maxLength==='number'&&raw.length>constraints.maxLength)reason='Value exceeds the declared maximum length.';
 if(typeof constraints.pattern==='string') {
  try{if(!new RegExp(constraints.pattern).test(raw))reason='Value does not match the declared format.';}catch{reason='The property definition contains an invalid format constraint.';}
 }
 const numeric=result.integer_value??result.decimal_value;
 if(numeric!==null&&typeof constraints.min==='number'&&numeric<constraints.min)reason='Value is below the declared minimum.';
 if(numeric!==null&&typeof constraints.max==='number'&&numeric>constraints.max)reason='Value exceeds the declared maximum.';
 return reason?{...result,compatibility:'legacy_incompatible',reason}:result;
}
/** Returns an actionable typed-write error without ever modifying authored input. */
export function validatePropertyValue(definition:PropertyDefinition, property:Pick<Property,'name'|'value'|'target_id'>, target?:Pick<Entity,'type'|'subtypes'|'vault_id'>):string|null {
 const value=classifyPropertyValue(definition,property,target);
 return value.compatibility==='legacy_incompatible'?value.reason:null;
}
