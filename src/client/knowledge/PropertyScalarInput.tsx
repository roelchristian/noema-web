import {useId} from 'react';
import type {PropertyDefinition} from '../../shared/property-definitions';
import {DateValueEditor} from './DateValueEditor';
import {Select} from '../components/Select';
import {t as uiText} from '../i18n';
interface Props {label:string;definition?:PropertyDefinition;value:string;disabled:boolean;onChange:(value:string)=>void}
/** Raw authored strings remain the submission value; controls never normalize on mount. */
export function PropertyScalarInput({label,definition,value,disabled,onChange}:Props) {
 const hint=useId(),kind=definition?.valueKind;
 if(kind==='boolean')return <Select aria-label={label} autoFocus value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}><option value="">{uiText('Not set')}</option><option value="unknown">{uiText('Unknown')}</option><option value="true">{uiText('True')}</option><option value="false">{uiText('False')}</option></Select>;
 const choices=definition?.validation.values??definition?.validation.enum;
 if(kind==='enum'&&Array.isArray(choices))return <Select aria-label={label} autoFocus value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}><option value="">{uiText('Not set')}</option>{choices.filter((item):item is string=>typeof item==='string').map(item=><option key={item} value={item}>{item}</option>)}</Select>;
 if(kind==='coordinates') {
  const parts=value.split(','),latitude=parts[0]?.trim()??'',longitude=parts[1]?.trim()??'';
  return <fieldset disabled={disabled} className="entity-property-coordinates"><legend>{label}</legend><label>{uiText('Latitude')}<input autoFocus aria-label={label+' · '+uiText('Latitude')} type="number" step="any" min={-90} max={90} value={latitude} onChange={event=>onChange(event.target.value+', '+longitude)}/></label><label>{uiText('Longitude')}<input aria-label={label+' · '+uiText('Longitude')} type="number" step="any" min={-180} max={180} value={longitude} onChange={event=>onChange(latitude+', '+event.target.value)}/></label><small>{uiText('Latitude −90 to 90; longitude −180 to 180.')}</small></fieldset>;
 }
 if(kind==='date')return <DateValueEditor label={label} value={value} disabled={disabled} onChange={onChange}/>;
 if(kind==='datetime')return <><input autoFocus aria-label={label} aria-describedby={hint} type="text" disabled={disabled} value={value} placeholder='2026-10-23T12:00:00Z' onChange={event=>onChange(event.target.value)}/><small id={hint}>{uiText('Include time and timezone when known. Existing temporal evidence remains authoritative.')}</small></>;
 if(kind==='url'||kind==='integer'||kind==='quantity'||kind==='identifier')return <input autoFocus aria-label={label} type={kind==='url'?'url':kind==='integer'?'number':'text'} step={kind==='integer'?1:undefined} inputMode={kind==='integer'?'numeric':kind==='quantity'?'decimal':undefined} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>;
 return <textarea autoFocus rows={kind==='long_text'||value.includes('\n')?3:1} aria-label={label} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>;
}
