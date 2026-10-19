import {t as uiText} from '../i18n';
import { useMemo, useState } from 'react';
import type { Block } from '../../shared/domain';
import { Modal, ModalHeader } from '../components/Modal';
import { cleanNote, defaultCleanupOptions, type CleanupOptions } from './cleanup';

const choices: {key: keyof CleanupOptions; label: string; detail: string}[] = [
  {key: 'paragraphBreaks', label: uiText("Reduce extra paragraph breaks"), detail: uiText("Keep one blank paragraph between blocks, remove blank paragraphs at the edges, and reduce repeated line breaks.")},
  {key: 'repeatedSpaces', label: uiText("Collapse repeated spaces and tabs"), detail: uiText("Replace runs of spaces or tabs with one space.")},
  {key: 'lineEdges', label: uiText("Trim whitespace at line edges"), detail: uiText("Remove spaces and tabs at the start and end of each line.")},
];

export function CleanupDialog({blocks, onApply, onClose}: {blocks: Block[]; onApply: (blocks: Block[]) => void; onClose: () => void}) {
  const [options, setOptions] = useState(defaultCleanupOptions);
  const preview = useMemo(() => cleanNote(blocks, options), [blocks, options]);
  const changed = preview.blocks !== blocks;
  return <Modal className="cleanup-dialog" titleId="cleanup-title" onClose={onClose} dismissOnBackdrop>
    <ModalHeader titleId="cleanup-title">{uiText("Clean up note")}</ModalHeader>
    <p>{uiText("Tidy spacing in this note. Formatting, entity links, code, and math are preserved.")}</p>
    <div className="cleanup-options">
      {choices.map(({key, label, detail}) => <label key={key} className="cleanup-option">
        <input type="checkbox" checked={options[key]} onChange={event => setOptions({...options, [key]: event.target.checked})}/>
        <span><strong>{label}</strong><small>{detail}</small></span>
      </label>)}
    </div>
    <p className="cleanup-summary" role="status" aria-live="polite">{changed ? [preview.changedBlocks ? `${preview.changedBlocks} ${preview.changedBlocks === 1 ? 'block' : 'blocks'} with spacing to tidy` : '', preview.removedBlocks ? `${preview.removedBlocks} empty ${preview.removedBlocks === 1 ? 'paragraph' : 'paragraphs'} to remove` : ''].filter(Boolean).join(' · ') + '.' : uiText("No changes needed with these options.")}</p>
    <div className="dialog-actions"><button type="button" className="button" onClick={onClose}>{uiText("Cancel")}</button><button type="button" className="button primary" disabled={!changed} onClick={() => { onApply(preview.blocks); onClose(); }}>{uiText("Clean up")}</button></div>
  </Modal>;
}
