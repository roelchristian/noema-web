import {liturgicalKey,liturgicalCalendar} from '../../src/shared/liturgical.ts';
import {romanUIDays,regionalUIDays} from '../fixtures/liturgical/ui-normalized-2026.mjs';

/** The exact normalized input windows exercised by UI and week-caption tests. */
export function normalizedUIDays(calendarId='grc-en') {
 return structuredClone(calendarId==='ph'?regionalUIDays:romanUIDays);
}

/** A fresh valid API year without parsing the raw annual provider feeds in UI tests.
 * The API validates all 365 dates, so unobserved dates have explicit synthetic
 * placeholders. Every displayed/asserted month and seasonal row retains exact
 * normalized provider data, checked in liturgical-calendar.test.mjs.
 */
export function liturgicalUIYear(calendarId='grc-en') {
 const days={};
 for(let date=new Date('2026-01-01T00:00:00Z');date.getUTCFullYear()===2026;date.setUTCDate(date.getUTCDate()+1)) {
  days[date.toISOString().slice(0,10)]={principal:{id:'synthetic-unobserved-day',name:'Synthetic unobserved day',rank:'WEEKDAY',rankName:'Weekday',seasons:[],colors:[],optional:false},alternatives:[]};
 }
 Object.assign(days,normalizedUIDays(calendarId));
 return {year:2026,providerKey:liturgicalKey(calendarId),providerVersion:'fixture',dataVersion:liturgicalCalendar(calendarId).label,generatedAt:'2026-10-23T00:00:00Z',days};
}
