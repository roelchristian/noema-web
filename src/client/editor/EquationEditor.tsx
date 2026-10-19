import {t as uiText} from '../i18n';
import type {KeyboardEventHandler,Ref} from 'react';
import {Icon} from '../components/Icon';
import {LatexEditor} from './LatexEditor';
import {renderMath} from './math';

interface Props {
  value:string;onChange:(source:string)=>void;displayMode?:boolean;
  inputRef?:Ref<HTMLTextAreaElement>;label:string;description:string;
  onKeyDown?:KeyboardEventHandler<HTMLTextAreaElement>;
  conversion?:{label:string;title?:string;disabled?:boolean;onClick:()=>void};
  onDone:()=>void;doneDisabled?:boolean;
}
/** Shared source, preview and footer for inline and display equation editing. */
export function EquationEditor({value,onChange,displayMode=false,inputRef,label,description,onKeyDown,conversion,onDone,doneDisabled}:Props) {
  return <>
    <LatexEditor inputRef={inputRef} autoFocus aria-label={label} aria-description={description} minHeight={32} maxHeight={160} value={value} onChange={event=>onChange(event.target.value)} onKeyDown={onKeyDown} placeholder={uiText("e.g. \\frac{a}{b}")} maxLength={10000}/>
    {value.trim()&&<div className="equation-editor-preview" aria-label={uiText("Equation preview")} dangerouslySetInnerHTML={{__html:renderMath(value,displayMode)}}/>}
    <div className="equation-editor-footer"><span>{uiText("LaTeX")}</span><div className="equation-editor-actions">
      {conversion&&<button type="button" className="equation-editor-action" title={conversion.title} disabled={conversion.disabled} onClick={conversion.onClick}>{conversion.label}</button>}
      <button type="button" className="equation-editor-action" disabled={doneDisabled} onClick={onDone}><Icon name="check"/>{uiText("Done")}</button>
    </div></div>
  </>;
}
