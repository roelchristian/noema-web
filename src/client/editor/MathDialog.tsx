import { useState } from 'react';
import { Modal } from '../components/Modal';
import { renderMath } from './math';
export function MathDialog({initial, onSave, onClose}: {initial: string; onSave: (source: string) => void; onClose: () => void}) {
  const [source, setSource] = useState(initial);
  return <Modal titleId="math-dialog-title" onClose={onClose} className="math-dialog"><form onSubmit={event => {event.preventDefault(); if (source.trim()) onSave(source.trim());}}>
    <h2 id="math-dialog-title">Inline equation</h2>
    <label>LaTeX<textarea autoFocus aria-label="Equation LaTeX" value={source} onChange={event => setSource(event.target.value)} placeholder={'e.g. \\frac{a}{b}'} maxLength={10000}/></label>
    <div className="math-preview" aria-label="Equation preview" dangerouslySetInnerHTML={{__html: renderMath(source)}}/>
    <div className="dialog-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={!source.trim()}>Save equation</button></div>
  </form></Modal>;
}
