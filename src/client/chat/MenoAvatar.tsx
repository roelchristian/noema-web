import {defaultPersonaId,personaMetadata} from '../../shared/ai-personas';
import {useEffect,useId,useState,type CSSProperties} from 'react';

const looks:Record<string,{colors:string[];body:string}>={
 oxford_don:{colors:['#fff4db','#eacb93','#b78a59'],body:'M24 64C24 38 39 25 60 25S96 38 96 64C96 89 82 101 60 101S24 89 24 64Z'},
 divinity_student:{colors:['#f6eeff','#cbbbe5','#9382bc'],body:'M30 60C30 35 47 22 60 18C73 22 90 35 90 60L94 87Q94 102 78 100Q60 107 42 100Q26 102 26 87Z'},
 editor:{colors:['#e6f4ff','#abc5da','#6e92b0'],body:'M40 29H80Q97 29 97 47V80Q97 99 79 99H41Q23 99 23 80V47Q23 29 40 29Z'},
 tutor:{colors:['#fff5d4','#f7d17b','#e4a153'],body:'M60 24C68 13 83 19 84 31C99 29 107 43 98 55C110 65 103 82 91 83C93 98 78 107 66 99C54 111 38 103 36 93C20 96 12 81 21 69C10 56 20 42 31 43C28 28 46 17 60 24Z'},
 antiquarian:{colors:['#edf3da','#b8cca0','#7e9c72'],body:'M23 61Q19 29 60 25Q101 29 97 61L88 88Q79 103 60 101Q41 103 32 88Z'},
 socratic:{colors:['#e2faf0','#a0d7c3','#62aa98'],body:'M28 69Q21 41 46 37Q46 16 66 22Q86 26 82 43Q104 44 98 68Q94 94 70 99Q37 108 28 69Z'},
 salon_wit:{colors:['#ffedf1','#eeb8cc','#c886ab'],body:'M60 23C78 22 96 41 97 62C99 84 84 99 60 100C36 99 21 84 23 62C24 41 42 22 60 23Z'},
};

/** A hand-free cast of soft characters, animated with small facial and body gestures. */
export function MenoAvatar({active=false,personaId=defaultPersonaId,decorative=false}:{active?:boolean;personaId?:string;decorative?:boolean}) {
 const look=looks[personaId]??looks[defaultPersonaId];
 const colors={'--meno-light':look.colors[0],'--meno-mid':look.colors[1],'--meno-shade':look.colors[2]} as CSSProperties;
 const id=useId().replace(/:/g,'');
 const [playful,setPlayful]=useState(false),[engaged,setEngaged]=useState(false);
 useEffect(()=>{if(!playful)return;const timer=window.setTimeout(()=>setPlayful(false),2400);return()=>window.clearTimeout(timer);},[playful]);
 const artwork=<>
  <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
   <defs>
    <radialGradient id={id+'-body'} cx="32%" cy="22%" r="85%"><stop offset="0" className="meno-light"/><stop offset=".48" className="meno-mid"/><stop offset="1" className="meno-shade"/></radialGradient>
   </defs>
   <ellipse className="meno-shadow" cx="60" cy="108" rx="27" ry="4"/>
   <g className="meno-float"><g className="meno-energy">
    <path fill={'url(#'+id+'-body)'} d={look.body}/>
    <path className="meno-highlight" d="M34 45Q39 33 51 32"/>
    {personaId==='oxford_don'&&<g className="meno-detail"><path className="meno-jacket" d="M27 81L43 87L60 100L78 86L94 79L91 91Q61 113 30 93Z"/><path d="M38 86L42 97L51 94M84 85L79 97L72 94"/><circle cx="60" cy="101" r="1.5"/></g>}
    {personaId==='divinity_student'&&<g className="meno-detail"><path className="meno-jacket" d="M29 81Q60 96 92 80L94 91Q83 105 60 104Q37 104 27 93Z"/><path className="meno-thread" d="M41 90L38 98M80 89L83 98"/></g>}
    {personaId==='editor'&&<g className="meno-detail"><path className="meno-jacket" d="M24 83Q61 95 96 82L96 89Q93 100 81 100H40Q26 100 24 90Z"/><path className="meno-thread" d="M35 90L35 96M42 92L42 98M49 94L49 99M71 94L71 99M78 92L78 98"/><path className="meno-pencil" d="M87 94L92 75L96 76L91 95L88 99Z"/></g>}
    {personaId==='salon_wit'&&<g className="meno-detail"><path className="meno-jacket" d="M27 82Q60 101 94 81L92 92Q61 111 29 93Z"/><path className="meno-thread" d="M39 88L42 98M82 87L78 99"/></g>}
    {personaId==='antiquarian'&&<g className="meno-hat"><path className="meno-cloth meno-cap" d="M17 46Q22 11 60 13Q98 11 103 46Q61 58 17 46Z"/><path className="meno-cap-rim" d="M19 46Q61 54 101 46"/><g className="meno-cap-spots"><ellipse cx="41" cy="29" rx="7" ry="4" transform="rotate(-20 41 29)"/><ellipse cx="72" cy="23" rx="5" ry="3"/><ellipse cx="86" cy="36" rx="6" ry="4"/><circle cx="56" cy="40" r="3"/></g><path className="meno-detail" d="M35 92Q59 104 84 91M42 97L44 103M75 97L74 103"/></g>}
    {personaId==='socratic'&&<path className="meno-sprout" d="M62 28Q50 9 41 17Q43 28 62 28Q64 9 77 13Q78 25 62 28"/>}
    {personaId==='salon_wit'&&<g className="meno-beret"><path d="M32 36Q29 18 57 15Q81 11 87 28Q61 27 32 36Z"/><path className="meno-detail" d="M58 16Q57 9 63 10M38 32Q60 23 82 27"/></g>}
    {personaId==='socratic'&&<g className="meno-leaf-veins"><path d="M62 28L48 19M62 28L72 17"/></g>}
    <g className="meno-face" transform="rotate(-3 63 60)"><g className="meno-eyes">
     <g className="meno-eye-left"><ellipse cx="49" cy="64" rx="4.6" ry="7"/><ellipse className="meno-glint" cx="50" cy="61" rx="1.4" ry="1.8"/></g><g className="meno-eye-right"><ellipse cx="78" cy="61" rx="4.6" ry="7"/><ellipse className="meno-glint" cx="79" cy="58" rx="1.4" ry="1.8"/></g>
    </g>
    {personaId==='tutor'&&<g className="meno-freckles"><circle cx="34" cy="74" r="1.2"/><circle cx="39" cy="76" r="1"/><circle cx="90" cy="72" r="1.2"/><circle cx="86" cy="74" r="1"/></g>}
    <ellipse className="meno-cheek" cx="38" cy="77" rx="7" ry="4"/><ellipse className="meno-cheek" cx="87" cy="74" rx="7" ry="4"/>
    <path className="meno-smile" d={playful&&!['oxford_don','divinity_student','editor'].includes(personaId)?'M54 78Q64 94 74 77Z':personaId==='salon_wit'?'M57 80Q68 84 74 75':personaId==='divinity_student'?'M59 80Q64 83 69 79':'M57 79Q64 85 71 78'}/>
    {personaId==='oxford_don'&&<g className="meno-accessory"><circle className="meno-lens" cx="78" cy="61" r="13"/><path className="meno-lens-shine" d="M72 53L76 50M72 57L80 50"/><path className="meno-chain" d="M90 64Q105 88 89 96"/><path className="meno-detail" d="M91 69L94 71M95 77L98 79M96 88L98 90"/><path className="meno-cloth" d="M50 91L62 95L74 89L74 102L62 97L51 103Z"/></g>}
    {personaId==='editor'&&<g className="meno-accessory meno-spectacles"><rect x="37" y="53" width="23" height="19" rx="6"/><rect x="67" y="50" width="23" height="19" rx="6"/><path d="M60 59L67 58M88 87L97 72"/></g>}
    {personaId==='tutor'&&<g className="meno-accessory"><path className="meno-cloth" d="M38 89Q63 101 85 87L82 99Q61 110 40 100Z"/><path className="meno-cloth" d="M73 99L77 112L85 109L82 96"/><path className="meno-thread" d="M44 94L44 101M52 97L52 103M77 105L84 103"/></g>}
    {personaId==='divinity_student'&&<g className="meno-accessory"><path className="meno-cloth" d="M40 91Q63 100 84 88L81 101Q61 110 42 102Z"/><path className="meno-collar" d="M57 96L68 95L68 103L58 104Z"/></g>}
    {personaId==='antiquarian'&&<g className="meno-accessory meno-spectacles"><circle cx="49" cy="64" r="11"/><circle cx="78" cy="61" r="11"/><path d="M60 61L67 60"/></g>}
    {personaId==='socratic'&&<g><path className="meno-brow" d="M72 47Q78 43 84 46"/><path className="meno-toga" d="M33 83Q51 99 86 91L81 98Q50 109 33 91Z"/><path className="meno-detail" d="M40 90Q56 99 72 98"/><circle className="meno-brooch" cx="83" cy="92" r="3"/></g>}
    {personaId==='salon_wit'&&<g className="meno-accessory"><path className="meno-cloth" d="M44 94L60 98L77 90L78 106L61 101L46 109Z"/><circle className="meno-collar" cx="61" cy="100" r="3"/></g>}
    {personaId==='oxford_don'&&<g className="meno-detail"><path className="meno-eyebrows" d="M43 52L53 52M73 47L83 47"/><path className="meno-pocket" d="M79 92L88 90L87 97L79 98Z"/><path className="meno-thread" d="M80 92L82 87L85 91L88 87L88 91"/><path d="M55 95L60 97L57 100M69 94L64 97L68 99"/></g>}
    {personaId==='divinity_student'&&<g className="meno-detail"><path className="meno-eyebrows" d="M44 53Q49 50 54 53M73 50Q78 47 83 50"/><path className="meno-thread" d="M47 96L46 101M76 94L78 100"/><circle cx="62" cy="107" r="1"/></g>}
    {personaId==='editor'&&<g className="meno-detail"><path className="meno-eyebrows" d="M44 47L53 47M73 44L82 44"/><path className="meno-lens-shine" d="M41 58L46 55M71 55L76 52"/><path d="M29 88L33 88M29 91L33 91"/><path className="meno-pencil-band" d="M91 80L95 81"/></g>}
    {personaId==='tutor'&&<g className="meno-detail"><path className="meno-eyebrows" d="M43 51Q48 47 54 51M72 48Q78 44 83 48"/><path className="meno-thread" d="M41 93L47 97L51 95L57 99L61 97L67 101M77 109L78 113M80 108L81 112M83 107L84 111"/><path className="meno-pin" d="M36 87L38 90L42 90L39 93L40 96L36 94L33 96L34 92L31 90L35 90Z"/></g>}
    {personaId==='antiquarian'&&<g className="meno-detail"><path className="meno-eyebrows" d="M41 49Q48 45 53 50M73 46L82 49"/><path className="meno-lens-shine" d="M42 60L47 56M72 57L77 53"/><path className="meno-patch" d="M29 82L40 80L42 90L31 92Z"/><path className="meno-thread" d="M30 84L33 83M32 90L35 89M39 83L40 86"/><path d="M70 96L75 94L78 98L83 95"/></g>}
    {personaId==='socratic'&&<g className="meno-detail"><path className="meno-thread" d="M44 91Q54 95 64 95M40 94Q52 101 67 99"/><path d="M81 92L83 90L85 92L83 94Z"/><path className="meno-eyebrows" d="M43 51L53 53"/></g>}
    {personaId==='salon_wit'&&<g className="meno-detail"><path className="meno-eyebrows" d="M42 52Q49 48 54 51M72 47Q78 43 84 46"/><path className="meno-thread" d="M49 99L56 100M68 98L73 96"/><circle className="meno-pin" cx="86" cy="89" r="3"/><path d="M84 89L86 87L88 89L86 91Z"/></g>}
    </g>
   </g></g>
  </svg>
 </>;
 if(decorative)return <span className="meno-avatar meno-preview" style={colors} data-persona={personaId} aria-hidden="true">{artwork}</span>;
 return <button style={colors} type="button" className="meno-avatar" data-active={active||engaged} data-engaged={engaged} data-playful={playful} data-thinking={active} data-persona={personaId} onPointerEnter={()=>setEngaged(true)} onPointerLeave={()=>setEngaged(false)} onFocus={()=>setEngaged(true)} onBlur={()=>setEngaged(false)} aria-label={`Play with Meno · ${personaMetadata(personaId).name}`} title={`Meno · ${personaMetadata(personaId).name} · Say hello!`} onClick={()=>setPlayful(true)}>
{artwork}</button>;
}
