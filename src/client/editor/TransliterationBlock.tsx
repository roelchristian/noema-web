import {t as uiText} from '../i18n';

export function TransliterationBlock({text}:{text:string}) {
  return <aside className="block-transliteration" contentEditable={false} lang="und-Latn" aria-label={uiText('Transliteration')}>
    <div>{text}</div>
  </aside>;
}
