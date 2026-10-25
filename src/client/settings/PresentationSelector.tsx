import {t as uiText} from '../i18n';
import type {PresentationMode} from './appearance';
import {ActionMenu} from '../components/ActionMenu';
import {Icon} from '../components/Icon';

const modes = [
  {value:'standard', label:'Standard', icon:'reference-highlight'},
  {value:'subtle', label:'Subtle', icon:'reference-subtle'},
  {value:'focus', label:'Focus', icon:'expand'},
] as const;
export function PresentationSelector({value, onChange, onExitFocus, inline=false}: {value: PresentationMode; onChange: (mode: PresentationMode) => void; onExitFocus: () => void; inline?:boolean}) {
  if (!inline) return <div className="presentation-control">
    {value==='focus'
      ? <button className="presentation-focus" type="button" aria-label={uiText('Exit Focus')} title={uiText('Exit Focus (Escape)')} onClick={onExitFocus}><Icon name="collapse"/></button>
      : <ActionMenu label={uiText('Presentation mode')} icon="creativework" showCheckedIcons lazy actions={modes.map(mode=>({
        id:mode.value,icon:mode.icon,label:uiText(mode.label),checked:value===mode.value,onSelect:()=>onChange(mode.value),
      }))}/>}
  </div>;
  return <div className="presentation-selector" role="group" aria-label={uiText('Presentation mode')}>
    {modes.map(mode=><button key={mode.value} className={mode.value==='focus'?'presentation-focus':undefined} type="button" aria-label={uiText(mode.value==='focus'&&value==='focus'?'Exit Focus':mode.label)} aria-pressed={value===mode.value}
      title={uiText(mode.value==='focus'&&value==='focus'?'Exit Focus (Escape)':mode.label)}
      onClick={()=>mode.value==='focus'&&value==='focus'?onExitFocus():onChange(mode.value)}><Icon name={mode.icon}/>{uiText(mode.value==='focus'&&value==='focus'?'Exit Focus':mode.label)}</button>)}
  </div>;
}
