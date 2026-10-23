import {useEffect,useState} from 'react';
import {liturgicalCalendar,type LiturgicalCalendarId} from '../../shared/liturgical';
export interface CalendarSettings {enabled:boolean;calendarId:LiturgicalCalendarId;optional:boolean;weekStart?:0|1;weekNumbers?:boolean;optionalIndicators?:boolean}
export const calendarSettingsStorageKey='noema.calendar.settings.v1';
export const defaultCalendarSettings=():CalendarSettings=>({enabled:false,calendarId:'grc-en',optional:false,weekStart:0,weekNumbers:false,optionalIndicators:true});
export function parseCalendarSettings(raw:string|null):CalendarSettings {
 const defaults=defaultCalendarSettings();
 try{const value=JSON.parse(raw??'null');if(value&&typeof value==='object')return {enabled:value.enabled===true,optional:value.optional===true,weekStart:value.weekStart===1?1:0,weekNumbers:value.weekNumbers===true,optionalIndicators:value.optionalIndicators!==false,calendarId:typeof value.calendarId==='string'?liturgicalCalendar(value.calendarId)?.id??defaults.calendarId:defaults.calendarId};}catch{/* Invalid preferences use defaults. */}
 return defaults;
}
export function useCalendarSettings() {
 const [settings,setSettings]=useState(()=>{try{return parseCalendarSettings(localStorage.getItem(calendarSettingsStorageKey));}catch{return defaultCalendarSettings();}});
 const [storageError,setStorageError]=useState(false);
 useEffect(()=>{try{localStorage.setItem(calendarSettingsStorageKey,JSON.stringify(settings));setStorageError(false);}catch{setStorageError(true);}},[settings]);
 return {settings,setSettings,storageError};
}
