import type {Segment} from '../../shared/domain';
import {t as uiText} from '../i18n';
import {segmentHTML} from './segments';

export function TransliterationBlock({content}:{content:Segment[]}) {
  return <aside className="block-transliteration" contentEditable={false} lang="und-Latn" aria-label={uiText('Transliteration')}>
    <div dangerouslySetInnerHTML={{__html:segmentHTML(content,[],undefined,true,undefined,false)}}/>
  </aside>;
}
