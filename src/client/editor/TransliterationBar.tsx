import {useLayoutEffect,useRef} from 'react';
import {Icon} from '../components/Icon';
import {t as uiText} from '../i18n';
import {rememberTransliteration,useTransliteration} from '../state/transliteration-preferences';

export function TransliterationBar({pageKey}:{pageKey:string}) {
  const layout=useTransliteration(pageKey);
  const bar=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const element=bar.current;
    if(!element)return;
    const workspace=element.closest('#content')??element.closest('article');
    const measure=()=>{
      const bounds=workspace?.getBoundingClientRect();
      if(bounds&&bounds.width>0){
        element.style.right=`${Math.max(16,window.innerWidth-bounds.right+16)}px`;
        element.style.maxWidth=`${Math.max(0,bounds.width-32)}px`;
      }
      const viewport=window.visualViewport;
      const keyboardInset=viewport?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0;
      element.style.setProperty('--transliteration-keyboard-inset',`${keyboardInset}px`);
    };
    measure();
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
    if(workspace)observer?.observe(workspace);
    window.addEventListener('resize',measure);
    window.visualViewport?.addEventListener('resize',measure);
    window.visualViewport?.addEventListener('scroll',measure);
    return()=>{
      observer?.disconnect();window.removeEventListener('resize',measure);
      window.visualViewport?.removeEventListener('resize',measure);
      window.visualViewport?.removeEventListener('scroll',measure);
    };
  },[layout,pageKey]);
  if(layout==='off')return null;
  return <div ref={bar} className="transliteration-bar" role="group" aria-label={uiText('Transliteration controls')} contentEditable={false}>
    <Icon name="culture"/>
    <span>{uiText('Transliteration on')}</span>
    <button type="button" aria-label={uiText('Hide transliteration')} onClick={()=>rememberTransliteration(pageKey,'off')}>
      {uiText('Hide')}
    </button>
  </div>;
}
