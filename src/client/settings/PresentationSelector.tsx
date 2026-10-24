import {t as uiText} from '../i18n';
import type {PresentationMode} from './appearance';

const modes = [
  {value:'standard', label:'Standard', description:'Standard · Emphasise references'},
  {value:'subtle', label:'Subtle', description:'Subtle · Quiet references, full workspace'},
  {value:'focus', label:'Focus', description:'Focus · Quiet references and hide surrounding panels'},
] as const;
export function PresentationSelector({value, onChange, onExitFocus}: {value: PresentationMode; onChange: (mode: PresentationMode) => void; onExitFocus: () => void}) {
  return <div className="presentation-selector" role="group" aria-label={uiText('Presentation mode')}>
    {modes.map(mode=><button key={mode.value} type="button" aria-label={uiText(mode.value==='focus'&&value==='focus'?'Exit Focus':mode.label)} aria-pressed={value===mode.value}
      title={uiText(mode.value==='focus'&&value==='focus'?'Exit Focus (Escape)':mode.description)}
      onClick={()=>mode.value==='focus'&&value==='focus'?onExitFocus():onChange(mode.value)}>{uiText(mode.value==='focus'&&value==='focus'?'Exit Focus':mode.label)}</button>)}
  </div>;
}
