import {liturgicalCalendar,type LiturgicalCalendarId} from '../../shared/liturgical';

const units=['prima','secunda','tertia','quarta','quinta','sexta','septima','octava','nona'];
const ordinals=new Map<string,number>();
for(let number=1;number<=34;number++) {
 const unit=units[(number%10)-1];
 const word=number<10?units[number-1]:number===10?'decima':number===11?'undecima':number===12?'duodecima':number<18?`decima ${units[number-11]}`:number===18?'duodevicesima':number===19?'undevicesima':number<30?`vigesima${unit?' '+unit:''}`:`trigesima${unit?' '+unit:''}`;
 ordinals.set(word!,number);
}
const roman=(number:number)=>'X'.repeat(Math.floor(number/10))+['','I','II','III','IV','V','VI','VII','VIII','IX'][number%10];
const ordinalPattern=[...ordinals.keys()].sort((a,b)=>b.length-a.length).join('|');
const weekPattern=new RegExp(`\\b(?:hebdomadae|hebd\\.)\\s+(${ordinalPattern.replace(/a(?= |\||$)/g,'ae')})(?=\\s|$)`,'gi');
const dayPattern=new RegExp(`^(Feria|Dominica) (${ordinalPattern})(?=\\s|$)`,'i');

/** Format at display time so existing offline calendars adopt the same notation. */
export function liturgicalLabel(name:string,id:LiturgicalCalendarId):string {
 if(liturgicalCalendar(id)!.locale!=='la')return name;
 // Match both the provider's ligatures and ordinary Latin spelling, keeping
 // personal names and other feast titles outside these temporal patterns intact.
 const expanded=name.replaceAll('æ','ae').replaceAll('Æ','Ae');
 const label=expanded.replace(weekPattern,(_match,ordinal:string)=>`hebd. ${roman(ordinals.get(ordinal.toLowerCase().replace(/ae\b/g,'a'))!)}`)
  .replace(dayPattern,(_match,day:string,ordinal:string)=>`${day} ${roman(ordinals.get(ordinal.toLowerCase())!)}`);
 const formatted=label.replace(/\bTemporis Paschali\b/gi,'Paschae').replace(/\bTemporis Ordinarii\b/gi,'per annum')
  .replace(/[«“"‘']\s*per annum\s*[»”"’']/gi,'per annum').replace(/\bper annum\b/gi,'per annum');
 return formatted===expanded?name:formatted;
}

/** Use sentence case for provider rank labels, including their Latin equivalents. */
export function liturgicalRankLabel(rank:string):string {
 const label=rank.trim().replace(/\s+/g,' ').toLowerCase();
 return (label.charAt(0).toUpperCase()+label.slice(1))
  .replace(/\b(lord|domini)\b/g,word=>word.charAt(0).toUpperCase()+word.slice(1))
  .replace(/\b(class) ([ivx]+)\b/gi,(_match,word:string,number:string)=>`${word} ${number.toUpperCase()}`);
}

/** Abbreviate saint titles only where month cells have limited space. */
export function monthLiturgicalLabel(name:string,id:LiturgicalCalendarId):string {
 const label=liturgicalLabel(name,id);
 if(liturgicalCalendar(id)!.locale!=='la')return label.replace(/\bSaints(?=\s|$)/g,'Sts').replace(/\bSaint(?=\s|$)/g,'St');
 return label.replace(/\bSanctorum(?=\s|$)/gi,'SS.').replace(/\bSanct(?:i|ae|æ)(?=\s|$)/gi,'S.');
}
