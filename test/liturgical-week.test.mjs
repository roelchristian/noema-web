import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liturgicalUIYear} from './helpers/liturgical-ui.mjs';
import {liturgicalWeekLabel,liturgicalWeekSeasonColor} from '../src/client/calendar/liturgical-week.ts';
const data=liturgicalUIYear();
const label=(start,end,mode='week',years=[data])=>liturgicalWeekLabel(start,end,years,mode);

test('Roman week captions retain Ordinary Time numbering and established seasonal designations',()=>{
 for(const [start,end,expected] of [
  ['2026-10-18','2026-10-24','29th Week in Ordinary Time'],
  ['2026-10-25','2026-10-31','30th Week in Ordinary Time'],
  ['2026-02-22','2026-02-28','1st Week of Lent'],
  ['2026-04-05','2026-04-11','Easter Octave'],
  ['2026-11-29','2026-12-05','1st Week of Advent'],
 ])assert.equal(label(start,end),expected);
 assert.equal(label('2026-10-18','2026-10-24','season'),'Ordinary Time');
});
test('rows describe season transitions while Monday rows retain their starting week',()=>{
 assert.equal(label('2026-02-15','2026-02-21'),'Ordinary Time → Lent');
 assert.equal(label('2026-12-20','2026-12-26'),'Advent → Christmas');
 assert.equal(label('2026-12-20','2026-12-26','season'),'Advent → Christmas');
 assert.equal(label('2026-10-19','2026-10-25'),'29th Week in Ordinary Time');
 assert.equal(label('2026-11-23','2026-11-29'),'Ordinary Time → Advent');
 assert.equal(label('2026-03-29','2026-04-04'),'Lent → Easter Triduum');
});
test('feasts do not replace week designations or seasonal accents',()=>{
 const changed=structuredClone(data);
 changed.days['2026-10-18'].principal={...changed.days['2026-10-18'].principal,id:'LocalPatron',name:'Our Local Patron',colors:['Red']};
 assert.equal(label('2026-10-18','2026-10-24','week',[changed]),'29th Week in Ordinary Time');
 assert.equal(liturgicalWeekSeasonColor('2026-10-18',[changed]),'green');
 assert.equal(liturgicalWeekSeasonColor('2026-12-25',[data]),'white');
});
test('incomplete data and malformed date ranges do not invent captions',()=>{
 const changed=structuredClone(data);delete changed.days['2026-10-20'];
 assert.equal(label('2026-10-18','2026-10-24','week',[changed]),null);
 assert.equal(label('2026-10-18','2026-10-24','week',[]),null);
 assert.equal(label('2026-02-30','2026-03-06'),null);
 assert.equal(label('2026-10-24','2026-10-18'),null);
 assert.equal(label('2026-10-18','2026-11-24'),null);
 const noWeek=structuredClone(data);
 for(const [date,day] of Object.entries(noWeek.days))if(date>='2026-10-18'&&date<='2026-10-24') {
  day.principal.id='saint';day.principal.name='Saint 29th of October';day.alternatives=[];
 }
 assert.equal(label('2026-10-18','2026-10-24','week',[noWeek]),'Ordinary Time');
});
test('stable temporal IDs support Latin provider labels without translating feast names',()=>{
 const latin=structuredClone(data);
 for(const day of Object.values(latin.days)) {
  day.principal.name='Feria';day.principal.seasons=day.principal.seasons.map(value=>value==='Ordinary Time'?'Tempus Ordinarium':value);
 }
 assert.equal(label('2026-10-18','2026-10-24','week',[latin]),'29th Week in Ordinary Time');
});
test('regional provider metadata gaps suppress uncertain captions',()=>{
 const regional=liturgicalUIYear('ph');
 // These feeds have no season metadata on saints' feasts. A full row cannot
 // reliably be labelled until the provider supplies that missing context.
 assert.equal(label('2026-10-18','2026-10-24','week',[regional]),null);
});
