import {useEffect,useRef} from 'react';
import {attachTransliterationHover} from './transliteration-hover';
import type {Segment} from '../../shared/domain';
import {t as uiText} from '../i18n';
import {segmentHTML} from './segments';

export function TransliterationBlock({content}:{content:Segment[]}) {
  const host=useRef<HTMLElement>(null);
  useEffect(()=>host.current?attachTransliterationHover(host.current):undefined,[content]);
  return <aside ref={host} className="block-transliteration" contentEditable={false} lang="und-Latn" dir="ltr" aria-label={uiText('Transliteration')}>
    <div dangerouslySetInnerHTML={{__html:segmentHTML(content,[],undefined,true,undefined,false)}}/>
  </aside>;
}
