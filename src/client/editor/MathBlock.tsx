import { useState } from 'react';
import type { Block } from '../../shared/domain';
import { renderMath } from './math';
export function MathBlock({block, onChange, onExit, onSave, onDelete, register}: {block: Block; onChange: (source: string) => void; onExit: () => void; onSave: () => void; onDelete: () => void; register: (el: HTMLDivElement | null) => void}) {
  const source = block.content.map(segment => segment.text ?? '').join('');
  const [editing, setEditing] = useState(!source);
  return <div className="math-block" ref={register} tabIndex={0} role="group" aria-label="Equation block" aria-description="Press Enter to add text below. Press Backspace or Delete to remove this equation." onKeyDown={event => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {event.preventDefault(); onSave();}
    if (event.key === 'Enter') {event.preventDefault(); onExit();}
    if (event.key === 'Backspace' || event.key === 'Delete') {event.preventDefault(); onDelete();}
  }}>
    <button type="button" className="math-block-render" aria-label="Edit equation" title="Edit equation" onClick={() => setEditing(value => !value)}>{source ? <span dangerouslySetInnerHTML={{__html: renderMath(source, true)}}/> : <span className="math-placeholder">Add a LaTeX equation…</span>}</button>
    {editing && <div className="math-block-source"><textarea autoFocus aria-label="Block equation LaTeX" placeholder={'e.g. \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}'} maxLength={10000} value={source} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {event.preventDefault(); onSave();}
      if (event.key === 'Escape') {event.preventDefault(); setEditing(false); event.currentTarget.closest<HTMLElement>('.math-block')?.querySelector('button')?.focus();}
      if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); setEditing(false); onExit();}
    }}/><small>LaTeX · Enter to continue below · Shift+Enter for a new line</small></div>}
  </div>;
}
