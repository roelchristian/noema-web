import {useEffect,useState} from 'react';
import {liturgicalCalendar,type LiturgicalCalendarId} from '../../shared/liturgical';
export interface CalendarSettings {enabled:boolean;calendarId:LiturgicalCalendarId;optional:boolean}
export const calendarSettingsStorageKey='noema.calendar.settings.v1';
export const defaultCalendarSettings=():CalendarSettings=>({enabled:false,calendarId:'grc-en',optional:false});
export function parseCalendarSettings(raw:string|null):CalendarSettings {
 const defaults=defaultCalendarSettings();
 try{const value=JSON.parse(raw??'null');if(value&&typeof value==='object')return {enabled:value.enabled===true,optional:value.optional===true,calendarId:typeof value.calendarId==='string'?liturgicalCalendar(value.calendarId)?.id??defaults.calendarId:defaults.calendarId};}catch{/* Invalid preferences use defaults. */}
 return defaults;
}
export function useCalendarSettings() {
 const [settings,setSettings]=useState(()=>{try{return parseCalendarSettings(localStorage.getItem(calendarSettingsStorageKey));}catch{return defaultCalendarSettings();}});
 const [storageError,setStorageError]=useState(false);
 useEffect(()=>{try{localStorage.setItem(calendarSettingsStorageKey,JSON.stringify(settings));setStorageError(false);}catch{setStorageError(true);}},[settings]);
 return {settings,setSettings,storageError};
}
