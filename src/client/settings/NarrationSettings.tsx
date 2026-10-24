import {useEffect,useRef,useState} from 'react';
import {createSpeechPreview} from '../api';
import {Select} from '../components/Select';
import {narrationCapabilities,parseNarrationPreferences,type NarrationPreferences,type Pronunciation} from '../../shared/narration';
import type {SpeechProvider,SpeechVoice} from '../../shared/intelligence';

/** Draft controls never synthesize or save until the user explicitly asks. */
export function NarrationSettings({value,onChange,provider,voice,vaultId,disabled,previewEnabled,view='detail'}:{value:NarrationPreferences;onChange:(value:NarrationPreferences)=>void;provider:SpeechProvider;voice:SpeechVoice;vaultId?:string;disabled:boolean;previewEnabled:boolean;view?:'overview'|'detail'}) {
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState('');
  const request=useRef<AbortController|null>(null),url=useRef('');
  const capability=narrationCapabilities(provider);
  function clear(){request.current?.abort();request.current=null;if(url.current){URL.revokeObjectURL(url.current);url.current='';}}
  useEffect(()=>{clear();setPreview('');setBusy(false);return clear;},[value,provider,voice,vaultId,previewEnabled,disabled,view]);
  function change(patch:Partial<NarrationPreferences>){setMessage('');onChange({...value,...patch});}
  async function listen(text:string,entry?:Pronunciation) {
    if(!vaultId||!previewEnabled)return;
    clear();setPreview('');setMessage('');
    const controller=new AbortController();request.current=controller;setBusy(true);
    try {
      const languageLocale:Record<string,NarrationPreferences['locale']>={en:value.locale.startsWith('en-')?value.locale:'en-US',de:'de-DE',fr:'fr-FR',es:'es-ES'};
      const narration=parseNarrationPreferences(entry?{...value,locale:languageLocale[entry.language]??value.locale,pronunciations:[{...entry,language:''}],rules:{acronyms:'preserve',abbreviations:'preserve',dates:'preserve',numbers:'preserve'}}:value);
      const audio=await createSpeechPreview(vaultId,text,provider,voice,narration,controller.signal);
      if(controller.signal.aborted||request.current!==controller)return;
      url.current=URL.createObjectURL(audio);setPreview(url.current);
    }catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:'Preview unavailable.');}
    finally{if(request.current===controller&&!controller.signal.aborted)setBusy(false);}
  }
  const locked=disabled;
  const canListen=!locked&&!busy&&!!vaultId&&previewEnabled;
  return <fieldset className="narration-settings" disabled={locked}>
    <legend>{view==='overview'?'Voice & delivery':'Narration & pronunciation'}</legend>
    {view==='detail'&&<p>{capability.description} Delivery is a preference; exact accent or tone is not guaranteed.</p>}
    {view==='overview'&&<>
    {capability.steering&&<div className="ai-setting-row"><label htmlFor="narration-preset">Delivery preset</label><Select id="narration-preset" value={value.preset} onChange={event=>change({preset:event.target.value as NarrationPreferences['preset']})}>{(['neutral','conversational','study','storytelling'] as const).map(option=><option key={option} value={option}>{option[0]!.toUpperCase()+option.slice(1)}</option>)}</Select></div>}
    <div className="ai-setting-row"><label htmlFor="narration-pace">Reading pace</label><Select id="narration-pace" value={value.pace} onChange={event=>change({pace:Number(event.target.value)})}><option value="0.75">Slower · deliberate</option><option value="1">Normal</option><option value="1.25">Faster · flowing</option></Select></div>
    </>}
    {view==='detail'&&<>
    {capability.accent&&<div className="ai-setting-row"><label htmlFor="narration-accent">Accent preference</label><Select id="narration-accent" value={value.accent} onChange={event=>change({accent:event.target.value as NarrationPreferences['accent']})}><option value="default">Voice default</option><option value="american">American English</option><option value="british">British English</option><option value="australian">Australian English</option></Select></div>}
    {capability.steering&&<><div className="ai-setting-row"><label htmlFor="narration-warmth">Tone</label><Select id="narration-warmth" value={value.warmth} onChange={event=>change({warmth:event.target.value as NarrationPreferences['warmth']})}><option value="default">Voice default</option><option value="warm">Warmer</option></Select></div>
    <div className="ai-setting-row"><label htmlFor="narration-expression">Expression</label><Select id="narration-expression" value={value.expressiveness} onChange={event=>change({expressiveness:event.target.value as NarrationPreferences['expressiveness']})}><option value="default">Voice default</option><option value="expressive">More expressive</option></Select></div></>}
    <details className="settings-advanced"><summary>Pauses and reading rules</summary>
      <p>App-managed silence after each block, across all providers.</p>
      {([['heading','Heading'],['paragraph','Paragraph'],['listItem','List item']] as const).map(([kind,label])=><div className="ai-setting-row" key={kind}><label htmlFor={'narration-pause-'+kind}>{label} pause (ms)</label><input id={'narration-pause-'+kind} type="number" min={0} max={3000} step={100} required value={value.pauses[kind]} onChange={event=>change({pauses:{...value.pauses,[kind]:Number(event.target.value)}})}/></div>)}
      <div className="ai-setting-row"><label htmlFor="narration-locale">Reading language and locale</label><Select id="narration-locale" value={value.locale} onChange={event=>change({locale:event.target.value as NarrationPreferences['locale']})}>{['en-US','en-GB','de-DE','fr-FR','es-ES'].map(locale=><option key={locale}>{locale}</option>)}</Select></div>
      {([['acronyms','Acronyms',[['preserve','Preserve'],['spell','Spell letters']]],['abbreviations','Abbreviations',[['preserve','Preserve'],['expand','Expand common abbreviations']]],['dates','Dates',[['preserve','Preserve'],['locale','Read using locale']]],['numbers','Numbers',[['preserve','Preserve'],['digits','Read individual digits']]]] as const).map(([key,label,options])=><div className="ai-setting-row" key={key}><label htmlFor={'narration-rule-'+key}>{label}</label><Select id={'narration-rule-'+key} value={value.rules[key]} onChange={event=>change({rules:{...value.rules,[key]:event.target.value}})}>{options.map(([id,text])=><option key={id} value={id}>{text}</option>)}</Select></div>)}
      <p>Rules change narration only. Source text stays unchanged; code, math and URLs are preserved. Dates expand only unambiguous ISO YYYY-MM-DD dates; abbreviation expansion uses a conservative language-specific list. Defaults leave formats to the voice.</p>
    </details>
    <details className="settings-advanced"><summary>Custom pronunciations ({value.pronunciations.length})</summary>
      <p>Literal whole-word replacements, applied once in the chosen reading language. Listen previews this entry in its language with other reading rules off. Up to 100 entries; word 80 characters, spoken form 200 characters.</p>
      {value.pronunciations.map((entry,index)=><fieldset key={index}><legend>Pronunciation {index+1}</legend>
        <div className="ai-setting-row"><label htmlFor={'pronunciation-word-'+index}>Word</label><input id={'pronunciation-word-'+index} maxLength={80} required value={entry.word} onChange={event=>change({pronunciations:value.pronunciations.map((item,i)=>i===index?{...item,word:event.target.value}:item)})}/></div>
        <div className="ai-setting-row"><label htmlFor={'pronunciation-spoken-'+index}>Spoken form</label><input id={'pronunciation-spoken-'+index} maxLength={200} required value={entry.spoken} onChange={event=>change({pronunciations:value.pronunciations.map((item,i)=>i===index?{...item,spoken:event.target.value}:item)})}/></div>
        <div className="ai-setting-row"><label htmlFor={'pronunciation-language-'+index}>Language</label><Select id={'pronunciation-language-'+index} value={entry.language} onChange={event=>change({pronunciations:value.pronunciations.map((item,i)=>i===index?{...item,language:event.target.value}:item)})}><option value="">All languages</option>{['en','de','fr','es'].map(language=><option key={language}>{language}</option>)}</Select></div>
        <label><input type="checkbox" checked={entry.caseSensitive} onChange={event=>change({pronunciations:value.pronunciations.map((item,i)=>i===index?{...item,caseSensitive:event.target.checked}:item)})}/> Match case</label>
        <div className="intelligence-actions"><button type="button" className="button" disabled={!canListen||!entry.word.trim()||!entry.spoken.trim()} onClick={()=>void listen(entry.word,entry)}>Listen to pronunciation {index+1}</button><button type="button" className="button danger" onClick={()=>change({pronunciations:value.pronunciations.filter((_,i)=>i!==index)})}>Remove pronunciation {index+1}</button></div>
      </fieldset>)}
      <button type="button" className="button" disabled={value.pronunciations.length>=100} onClick={()=>change({pronunciations:[...value.pronunciations,{word:'',spoken:'',caseSensitive:false,language:''}]})}>Add pronunciation</button>
    </details>
    </>}
    <button type="button" className="button" disabled={!canListen} onClick={()=>void listen('A thoughtful voice can make an ordinary sentence easier to follow. Take a moment, then continue reading.')}>{busy?'Generating preview…':'Listen to sample'}</button>
    <p>Listen uses these draft narration settings. {provider==='kokoro'?'Generated locally.':'Text is sent to the selected provider and API charges apply.'} Saved defaults stay unchanged. An unlocked vault is required.</p>
    {preview&&<audio controls autoPlay src={preview} aria-label="Narration preview"/>}
    {busy&&<button type="button" className="button" onClick={()=>{clear();setBusy(false);}}>Cancel preview</button>}
    <p role="status" aria-live="polite">{message}</p>
  </fieldset>;
}
