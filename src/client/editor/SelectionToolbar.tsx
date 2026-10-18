import { semanticFunctions, editableSemanticKinds, type SemanticKind } from '../../shared/semantic-blocks';
import { clearEditorSelection, editorSelectionRange, editorSelectionRanges, selectedEditorBlocks } from './block-selection';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { entityLabels, type Entity } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Modal, ModalHeader } from '../components/Modal';
import { annotationSuggestions, selectionPopoverPlacement } from './selection-annotation';
import { segmentHTML } from './segments';

interface Props {
  mobile?: boolean;
  keyboardInset?: number;
  viewportHeight?: number;
  onExplain?: () => void;
  explaining?: boolean;
  explainLabel?: (ids: string[]) => string;
  editor: RefObject<HTMLDivElement | null>;
  entities: Entity[];
  onCommit: () => void;
  onSemantic: (kind: SemanticKind) => void;
  onAddAlias: (id: string, alias: string) => Promise<void>;
  onMath: (range: Range) => void;
  onCreateEntity: (name: string, onCreated: (id: string) => void) => void;
}
const formats = [
  {command: 'bold', label: 'Bold', glyph: <b>B</b>},
  {command: 'italic', label: 'Italic', glyph: <i>I</i>},
  {command: 'underline', label: 'Underline', glyph: <u>U</u>},
  {command: 'strikeThrough', label: 'Strikethrough', glyph: <s>S</s>},
];
function editable(node: Node) {
  return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.block-content[contenteditable="true"]');
}
export function SelectionToolbar({mobile = false, keyboardInset = 0, viewportHeight, editor, entities, onCommit, onAddAlias, onCreateEntity, onMath, onSemantic, onExplain, explaining, explainLabel}: Props) {
  const [anchor, setAnchor] = useState<{left: number; right: number; top: number; bottom: number} | null>(null);
  const [annotating, setAnnotating] = useState(false), [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [more, setMore] = useState(false);
  const [linking, setLinking] = useState(false);
  const [savingAlias, setSavingAlias] = useState(false), [aliasError, setAliasError] = useState('');
  const [active, setActive] = useState<string[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const explanationAction = explainLabel?.(selectedIds) ?? 'Explain with AI';
  const [position, setPosition] = useState<{left: number; top: number; maxHeight?: number}>({left: 0, top: 0});
  const saved = useRef<Range | null>(null), surface = useRef<HTMLDivElement>(null);
  const picking = useRef(false);
  const latest = useRef({entities, onCommit}); latest.current = {entities, onCommit};
  function releaseSheet() { surface.current?.querySelector<HTMLDialogElement>('.mobile-selection-sheet')?.close(); }
  function dismiss() { releaseSheet(); saved.current = null; picking.current = false; setMore(false); setSemantic(false); setAnnotating(false); setLinking(false); setAnchor(null); }
  function closePicker() {
    releaseSheet(); picking.current = false; setMore(false); setSemantic(false); setAnnotating(false); setLinking(false);
    if (saved.current && !restore(saved.current)) dismiss();
  }
  useEffect(() => {
    let frame: number | undefined, collapseTimer: ReturnType<typeof setTimeout> | undefined;
    function inspect() {
      frame = undefined;
      if (picking.current || surface.current?.contains(document.activeElement) || editor.current?.hasAttribute('data-text-selecting')) return;
      const dialog = document.querySelector('dialog[open]');
      if (dialog && !surface.current?.contains(dialog)) { dismiss(); return; }
      const selection = getSelection();
      const range = editor.current ? editorSelectionRange(editor.current, selection) : null;
      if (!range || range.collapsed) {
        // Touch selection handles can briefly collapse the range while moving.
        if (mobile) {
          if (!collapseTimer) collapseTimer = setTimeout(() => {
            collapseTimer = undefined;
            if (!picking.current && (!getSelection()?.rangeCount || getSelection()?.isCollapsed)) dismiss();
          }, 150);
        } else dismiss();
        return;
      }
      clearTimeout(collapseTimer); collapseTimer = undefined;
      const portions = editor.current ? editorSelectionRanges(editor.current, range) : [];
      const start = editable(range.startContainer) ?? (portions[0] ? editable(portions[0].startContainer) : undefined);
      const end = editable(range.endContainer) ?? (portions.at(-1) ? editable(portions.at(-1)!.endContainer) : undefined);
      const selectedBlocks=editor.current ? selectedEditorBlocks(editor.current,selection) : null;
      if (!selectedBlocks || !portions.length || (start && !editor.current?.contains(start)) || (end && !editor.current?.contains(end)) || selectedBlocks.elements.some(el => el.dataset.semanticKind === 'ai-explanation' || el.closest('[data-block-group-id]')?.getAttribute('data-semantic-kind') === 'ai-explanation')) { dismiss(); return; }
      // Entity references are atomic; do not offer annotation inside an existing reference.
      const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      if (parent?.closest('[data-entity],[data-math]')) { dismiss(); return; }
      const box = range.getBoundingClientRect();
      if (!box.width && !box.height) { dismiss(); return; }
      saved.current = range.cloneRange();
      setSelectedCount(selectedBlocks.elements.length);
      setSelectedIds(selectedBlocks.elements.map(element=>element.dataset.blockId!));
      setActive(formats.filter(format => document.queryCommandState(format.command)).map(format => format.command));
      setAnchor({left: box.left, right: box.right, top: box.top, bottom: box.bottom});
    }
    function outside(event: PointerEvent) {
      if (surface.current?.contains(event.target as Node)) return;
      if (mobile && (editor.current?.contains(event.target as Node) || event.pointerType === 'touch' && editor.current?.contains(document.activeElement) && !(event.target instanceof Element && event.target.closest('button, input, textarea, a')))) return;
      dismiss();
    }
    function scheduleInspect() { if (frame === undefined) frame = requestAnimationFrame(inspect); }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || !saved.current) return;
      if (picking.current) { closePicker(); event.preventDefault(); return; }
      const range = saved.current;
      if (!editable(range.endContainer) && editor.current) {
        const end = editorSelectionRanges(editor.current, range).at(-1);
        if (end) range.setEnd(end.endContainer, end.endOffset);
      }
      range.collapse(false);
      if(editor.current)clearEditorSelection(editor.current);
      dismiss();
      editable(range.startContainer)?.focus({preventScroll: mobile});
      getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
      event.preventDefault();
    }
    const hideOnScroll = (event: Event) => { if (!surface.current?.contains(event.target as Node)) { if (mobile) scheduleInspect(); else dismiss(); } };
    const resize = () => { if (mobile) scheduleInspect(); else dismiss(); };
    const root=editor.current;
    root?.addEventListener('noema:editor-selection',scheduleInspect);
    document.addEventListener('selectionchange', scheduleInspect);
    document.addEventListener('pointerup', scheduleInspect);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', hideOnScroll, true);
    window.addEventListener('resize', resize);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(collapseTimer);
      root?.removeEventListener('noema:editor-selection',scheduleInspect);
      document.removeEventListener('selectionchange', scheduleInspect);
      document.removeEventListener('pointerup', scheduleInspect);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', hideOnScroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [editor, mobile]);
  useLayoutEffect(() => {
    if (mobile || !anchor || !surface.current) return;
    const box = surface.current.getBoundingClientRect();
    setPosition(selectionPopoverPlacement(anchor, {width: box.width, height: surface.current.scrollHeight + 2}, {width: innerWidth, height: innerHeight}));
  }, [mobile, anchor, annotating, semantic, linking, query, entities]);
  function restore(range: Range) {
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return false;
    editable(range.startContainer)?.focus({preventScroll: mobile});
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    return true;
  }
  function applyFormat(command: string) {
    const range = saved.current;
    if (!range || !restore(range)) { dismiss(); return; }
    const ranges = editor.current ? editorSelectionRanges(editor.current, range) : [];
    const original = range.cloneRange();
    const enable = !ranges.every(part => {restore(part); return document.queryCommandState(command);});
    const root = editor.current;
    if (root) root.dataset.formattingTransaction = 'true';
    try {
      for (const part of ranges) { if (restore(part) && document.queryCommandState(command) !== enable) document.execCommand(command); }
    } finally { if (root) delete root.dataset.formattingTransaction; }
    restore(original);
    latest.current.onCommit();
    const selection = getSelection();
    if (selection?.rangeCount) saved.current = selection.getRangeAt(0).cloneRange();
    setActive(formats.filter(item => document.queryCommandState(item.command)).map(item => item.command));
  }
  function connect(range: Range, text: string, id: string) {
    // A create dialog may outlive an edit or page navigation. Never replace stale text.
    if (!range.startContainer.isConnected || !range.endContainer.isConnected || range.toString() !== text || !editor.current?.contains(range.commonAncestorContainer)) return false;
    releaseSheet();
    range.deleteContents();
    const wrapper = document.createElement('span');
    wrapper.innerHTML = segmentHTML([{entityId: id, mentionText: text}], latest.current.entities);
    const mention = wrapper.firstChild!; range.insertNode(mention);
    range.setStartAfter(mention); range.collapse(true); restore(range);
    latest.current.onCommit(); dismiss();
    return true;
  }
  if (!anchor) return null;
  const range = saved.current;
  const single = range && editor.current && editorSelectionRanges(editor.current, range).length === 1;
  const selectedText = range?.toString().trim() || '';
  const {exact, results} = annotationSuggestions(entities, selectedText, query);
  const linkEntity = async (id: string) => {
    const current = saved.current;
    if (!current || savingAlias) return;
    const range = current.cloneRange(), text = current.toString();
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return;
    setSavingAlias(true); setAliasError('');
    try {
      await onAddAlias(id,text.trim());
      if (saved.current === current && !connect(range,text,id)) throw new Error('The selected text changed while saving the alias. Select it again to link it.');
    } catch (error) { setAliasError(error instanceof Error ? error.message : String(error)); }
    finally { setSavingAlias(false); }
  };
  const createFromSelection = () => {
    const current = saved.current?.cloneRange(); if (!current) return;
    const text = current.toString();
    dismiss();
    onCreateEntity(text.trim().slice(0, 200), id => connect(current, text, id));
  };
  const picker = <>
    {more && <div className="selection-more-actions">
      <button type="button" aria-pressed={active.includes('strikeThrough')} onClick={() => {
        releaseSheet(); picking.current = false; setMore(false); applyFormat('strikeThrough');
      }}><s>S</s><span>Strikethrough</span></button>
      <button type="button" disabled={!single} onClick={() => { const current = saved.current?.cloneRange(); if (current) { dismiss(); onMath(current); } }}><Icon name="equation"/><span>Inline equation</span></button>
      <button type="button" disabled={explaining || !onExplain} onClick={() => { const current = saved.current; releaseSheet(); if (current && restore(current)) onExplain?.(); dismiss(); }}><Icon name="sparkles"/><span>{explanationAction}</span></button>
      <button type="button" onClick={() => { setMore(false); setSemantic(true); }}><Icon name="semantic"/><span>Semantic function</span><Icon name="chevron"/></button>
      <button type="button" disabled={!single} onClick={() => { setMore(false); setAnnotating(true); setLinking(false); setQuery(''); setAliasError(''); }}><Icon name="knowledge"/><span>Annotate selection</span><Icon name="chevron"/></button>
    </div>}
    {semantic && <div className="semantic-picker" role="region" aria-label="Semantic functions"><p>{selectedCount===1 ? 'Apply a function to this block' : 'Group selected blocks under one function'}</p>{editableSemanticKinds.map(kind=><button type="button" key={kind} onClick={()=>{const range=saved.current;releaseSheet();if(range&&restore(range))onSemantic(kind);dismiss();}}><span style={{color:semanticFunctions[kind].color}}><Icon name={semanticFunctions[kind].icon}/></span><span>{semanticFunctions[kind].label}<small>{semanticFunctions[kind].description}</small></span></button>)}</div>}
    {annotating && <div className="selection-entities" role="region" aria-label="Annotate selection" aria-busy={savingAlias}>
      {savingAlias && <p role="status">Saving alias…</p>}
      {aliasError && <p role="alert">{aliasError}</p>}
      {linking ? <>
        <button type="button" className="selection-back" onClick={() => { setLinking(false); setQuery(''); }}>Back to annotation options</button>
        <input autoFocus aria-label="Search knowledge entities" placeholder="Find an existing entity…" value={query} onChange={event => setQuery(event.target.value)}/>
        <p>Link the highlighted text and save it as an alias for future tagging.</p>
        <div className="selection-entity-results">
          {results.map(entity => <button type="button" key={entity.id} disabled={savingAlias} onClick={() => void linkEntity(entity.id)}><Icon name={entity.type}/><span>{entity.name}<small>{entityLabels[entity.type]}</small></span></button>)}
          {!results.length && <div className="selection-empty">No matching entities</div>}
        </div>
      </> : <>
        {!!exact.length && <><p>Matching {exact.length === 1 ? 'entity' : 'entities'}</p><div className="selection-entity-results">{exact.map(entity => <button type="button" key={entity.id} disabled={savingAlias} onClick={() => void linkEntity(entity.id)}><Icon name={entity.type}/><span>{entity.name}<small>{entityLabels[entity.type]}</small></span></button>)}</div></>}
        {!exact.length && <button type="button" className="selection-create" onClick={createFromSelection}><Icon name="plus"/><span>Add “{selectedText.length > 60 ? selectedText.slice(0, 60) + '…' : selectedText}” as new entity</span></button>}
        <button type="button" onClick={() => setLinking(true)}><Icon name="knowledge"/><span>Link to {exact.length ? 'another' : 'existing'} entity</span></button>
      </>}
    </div>}
  </>;
  return <div ref={surface} className={'selection-popover' + (mobile ? ' mobile-selection-popover' : '')}
    data-keyboard-open={keyboardInset > 0 ? true : undefined}
    style={mobile ? {bottom: keyboardInset, '--selection-keyboard-inset': `${keyboardInset}px`, '--selection-viewport-height': `${viewportHeight ?? window.innerHeight}px`} as CSSProperties : position}
    onPointerDown={event => {
      // Keep native selection and the keyboard when tapping toolbar buttons.
      if (mobile && !(event.target as Element).closest('dialog') && (event.target as Element).closest('button')) event.preventDefault();
    }}
    onMouseDown={event => { if (!(event.target instanceof HTMLInputElement) && !(event.target as Element).closest('dialog')) event.preventDefault(); }}>
    <div className="selection-toolbar-row">
      <div className="selection-toolbar" role="toolbar" aria-label="Selection formatting" aria-orientation="horizontal">
        {(mobile ? formats.slice(0, 3) : formats).map(format => <button key={format.command} type="button" title={format.label} aria-label={format.label} aria-pressed={active.includes(format.command)} disabled={!range || !editor.current || !editorSelectionRanges(editor.current,range).length} onClick={() => applyFormat(format.command)}>{format.glyph}</button>)}
        {!mobile && <>
        <button type="button" aria-label="Inline equation" title="Inline equation" disabled={!single} onClick={() => {const current = saved.current?.cloneRange(); if (current) {dismiss(); onMath(current);}}}><Icon name="equation"/></button>
        <span className="selection-divider"/>
        <button type="button" aria-label={explanationAction} title={explanationAction} disabled={explaining || !onExplain} onClick={()=>{const range=saved.current;if(range&&restore(range))onExplain?.();dismiss();}}><Icon name="sparkles"/><span className="selection-action-label">{explanationAction}</span></button>
        <button type="button" className="selection-semantic" title="Apply a semantic function" aria-expanded={semantic} aria-haspopup={mobile ? 'dialog' : undefined} aria-label="Semantic block function" onClick={()=>{picking.current=!semantic;setSemantic(!semantic);setAnnotating(false);setLinking(false);}}><Icon name="semantic"/><span className="selection-action-label">Semantic</span></button>
        <button type="button" className="selection-annotate" disabled={!single} aria-label="Annotate selection" title={single ? 'Connect selection to a knowledge entity' : 'Select text within one block or table cell to annotate'} aria-haspopup={mobile ? 'dialog' : undefined} aria-expanded={annotating} onClick={() => { picking.current = !annotating; setSemantic(false); setAnnotating(!annotating); setLinking(false); setQuery(''); setAliasError(''); }}><Icon name="knowledge"/><span className="selection-action-label">Annotate</span></button>
        </>}
        {mobile && <button type="button" aria-label="More text actions" title="More text actions" aria-haspopup="dialog" aria-expanded={more || semantic || annotating} onClick={() => { picking.current = true; setMore(true); setSemantic(false); setAnnotating(false); setLinking(false); }}><Icon name="more"/></button>}
      </div>
      {mobile && <button type="button" className="selection-done" aria-label="Finish text selection" title="Finish text selection" onClick={() => {
        const current = saved.current?.cloneRange();
        if (current && editor.current) {
          const end = editorSelectionRanges(editor.current, current).at(-1)?.cloneRange();
          if (end) { end.collapse(false); restore(end); }
        }
        dismiss();
      }}><Icon name="check"/></button>}
    </div>
    {mobile && (more || semantic || annotating) ? <Modal className="mobile-selection-sheet" titleId="mobile-selection-sheet-title" onClose={closePicker} dismissOnBackdrop>
      <ModalHeader titleId="mobile-selection-sheet-title" actions={!more&&<button type="button" className="selection-picker-back" aria-label="Back to text actions" onClick={() => { setMore(true); setSemantic(false); setAnnotating(false); setLinking(false); }}><Icon name="chevron"/></button>} closeLabel="Back to selection">{more ? 'Text actions' : semantic ? 'Semantic function' : 'Annotate selection'}</ModalHeader>
      <p className="mobile-selection-preview">{selectedText.length > 120 ? selectedText.slice(0, 120) + '…' : selectedText}</p>
      {picker}
    </Modal> : picker}
  </div>;
}
