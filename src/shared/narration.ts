import type {SpeechProvider} from './intelligence.js';

/** Bump whenever pronunciation or reading-rule semantics change. */
export const narrationVersion='narration-v1';
export const narrationLocales=['en-US','en-GB','de-DE','fr-FR','es-ES'] as const;
export interface Pronunciation {word:string;spoken:string;caseSensitive:boolean;language:string}
export interface NarrationPreferences {
  preset:'neutral'|'conversational'|'study'|'storytelling';
  pace:number;
  accent:'default'|'american'|'british'|'australian';
  warmth:'default'|'warm';
  expressiveness:'default'|'expressive';
  pauses:{heading:number;paragraph:number;listItem:number};
  locale:typeof narrationLocales[number];
  pronunciations:Pronunciation[];
  rules:{acronyms:'preserve'|'spell';abbreviations:'preserve'|'expand';dates:'preserve'|'locale';numbers:'preserve'|'digits'};
}
export const defaultNarrationPreferences:NarrationPreferences={preset:'neutral',pace:1,accent:'default',warmth:'default',expressiveness:'default',pauses:{heading:0,paragraph:0,listItem:0},locale:'en-US',pronunciations:[],rules:{acronyms:'preserve',abbreviations:'preserve',dates:'preserve',numbers:'preserve'}};
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new RangeError('Invalid narration preferences.');return value as Record<string,unknown>;};
function choice<T extends string>(value:unknown,allowed:readonly T[]):T {if(typeof value!=='string'||!allowed.includes(value as T))throw new RangeError('Choose a supported narration option.');return value as T;}
export function parseNarrationPreferences(input:unknown):NarrationPreferences {
  const value=object(input),pauses=object(value.pauses),rules=object(value.rules);
  if(typeof value.pace!=='number'||!Number.isFinite(value.pace)||value.pace<0.75||value.pace>1.25)throw new RangeError('Narration pace must be between 0.75 and 1.25.');
  const pause=(key:string)=>{const duration=pauses[key];if(typeof duration!=='number'||!Number.isInteger(duration)||duration<0||duration>3000)throw new RangeError('Pauses must be between 0 and 3,000 milliseconds.');return duration;};
  if(!Array.isArray(value.pronunciations)||value.pronunciations.length>100)throw new RangeError('Use at most 100 pronunciations.');
  const seen=new Set<string>();
  const pronunciations=value.pronunciations.map(input=>{
    const entry=object(input);
    const text=(key:string,max:number)=>{const text=entry[key];if(typeof text!=='string'||!text.trim()||text.length>max||/[\x00-\x1f\x7f]/.test(text))throw new RangeError('Pronunciations require a word (up to 80 characters) and spoken form (up to 200 characters).');return text.trim().normalize('NFC');};
    const word=text('word',80),spoken=text('spoken',200),language=choice(entry.language,['','en','de','fr','es']);
    if(typeof entry.caseSensitive!=='boolean')throw new RangeError('Choose pronunciation case matching.');
    const identity=JSON.stringify([word.toLocaleLowerCase(),language]);if(seen.has(identity))throw new RangeError('Remove duplicate pronunciation words for the same language.');seen.add(identity);
    return {word,spoken,language,caseSensitive:entry.caseSensitive};
  });
  return {preset:choice(value.preset,['neutral','conversational','study','storytelling']),pace:value.pace,accent:choice(value.accent,['default','american','british','australian']),warmth:choice(value.warmth,['default','warm']),expressiveness:choice(value.expressiveness,['default','expressive']),pauses:{heading:pause('heading'),paragraph:pause('paragraph'),listItem:pause('listItem')},locale:choice(value.locale,narrationLocales),pronunciations,rules:{acronyms:choice(rules.acronyms,['preserve','spell']),abbreviations:choice(rules.abbreviations,['preserve','expand']),dates:choice(rules.dates,['preserve','locale']),numbers:choice(rules.numbers,['preserve','digits'])}};
}
export function narrationCapabilities(provider:SpeechProvider) {
  return provider==='kokoro'
    ?{steering:false,pace:'native' as const,accent:false,description:'Kokoro supports generated pace. Accent follows the selected voice; delivery presets, warmth and expressiveness are unavailable.'}
    :{steering:true,pace:provider==='openai'?'native' as const:'prompt' as const,accent:true,description:'Delivery and accent are model guidance. Gemini pace is guidance; OpenAI uses generated audio speed. Exact output can vary; use Preview before a long recording.'};
}
/** Only app-owned, validated phrases enter instructions; authored text stays separate. */
export function narrationDelivery(preferences:NarrationPreferences,includePace=true):string {
  const preset={neutral:'Clear, natural narration at a steady pace.',conversational:'Relaxed, conversational narration with smooth phrasing.',study:'Deliberate educational narration with clear diction and emphasis on important phrases.',storytelling:'Engaging storytelling with varied intonation and expressive phrasing.'}[preferences.preset];
  return [preset,includePace&&preferences.pace<1?'Speak more slowly and deliberately.':includePace&&preferences.pace>1?'Speak faster with a flowing delivery.':'',preferences.accent==='default'?'':`Use an ${preferences.accent} regional accent where appropriate for the original language.`,preferences.warmth==='warm'?'Use a warmer, friendly tone.':'',preferences.expressiveness==='expressive'?'Use greater vocal expressiveness.':''].filter(Boolean).join(' ');
}
