import {t as uiText} from '../i18n';
import { semanticFunctions, editableSemanticKinds, type SemanticKind } from '../../shared/semantic-blocks';
import { clearEditorSelection, editorSelectionRange, editorSelectionRanges, selectedEditorBlocks } from './block-selection';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { entityLabels, type Entity } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Modal, ModalHeader } from '../components/Modal';
import { annotationSuggestions, selectionPopoverPlacement } from './selection-annotation';
import type { MentionMatchOptions } from './mention-picker';
import { segmentHTML } from './segments';
import {applyEditorTextFormat,textFormatShortcuts,type TextFormat} from './text-formatting';

interface Props {
  mobile?: boolean;
  keyboardInset?: number;
  viewportHeight?: number;
  onReview?:()=>void;
  reviewing?:boolean;
  onExplain?: () => void;
  explaining?: boolean;
  explainLabel?: (ids: string[]) => string;
  editor: RefObject<HTMLDivElement | null>;
  entities: Entity[];
  suggestionContext?: MentionMatchOptions;
  onCommit: () => void;
  onSemantic: (kind: SemanticKind) => void;
  onAddAlias: (id: string, alias: string) => Promise<void>;
  onMath: (range: Range) => void;
  onCreateEntity: (name: string, onCreated: (id: string) => void) => void;
}
const formats = [
  {command: 'bold', get label(){return uiText("Bold")}, glyph: <b>B</b>},
  {command: 'italic', get label(){return uiText("Italic")}, glyph: <i>I</i>},
  {command: 'underline', get label(){return uiText("Underline")}, glyph: <u>U</u>},
  {command: 'strikeThrough', get label(){return uiText("Strikethrough")}, glyph: <s>S</s>},
] as const;
function editable(node: Node) {
  return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.block-content[contenteditable="true"]');
}
export function SelectionToolbar({mobile = false, keyboardInset = 0, viewportHeight, editor, entities, suggestionContext, onCommit, onAddAlias, onCreateEntity, onMath, onSemantic, onExplain, explaining, explainLabel, onReview, reviewing}: Props) {
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
  function applyFormat(command: TextFormat) {
    const range = saved.current;
    if (!range || !restore(range)) { dismiss(); return; }
    const root = editor.current;
    if(!root||!applyEditorTextFormat(root,range,command,()=>latest.current.onCommit()))return;
    const selection = getSelection();
    if (selection?.rangeCount) saved.current = editorSelectionRange(root,selection)?.cloneRange()??null;
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
  const {exact, results} = annotationSuggestions(entities, selectedText, query, suggestionContext);
  const linkEntity = async (id: string) => {
    const current = saved.current;
    if (!current || savingAlias) return;
    const range = current.cloneRange(), text = current.toString();
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return;
    setSavingAlias(true); setAliasError('');
    try {
      await onAddAlias(id,text.trim());
      if (!connect(range,text,id)) throw new Error('The selected text changed while saving the alias. Select it again to link it.');
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
      <button type="button" aria-pressed={active.includes('strikeThrough')} title={uiText("Strikethrough ({value0})",{value0: textFormatShortcuts.strikeThrough})} onClick={() => {
        releaseSheet(); picking.current = false; setMore(false); applyFormat('strikeThrough');
      }}><s>S</s><span>{uiText("Strikethrough")}</span></button>
      <button type="button" disabled={!single} onClick={() => { const current = saved.current?.cloneRange(); if (current) { dismiss(); onMath(current); } }}><Icon name="equation"/><span>{uiText("Inline equation")}</span></button>
      {onReview&&<button type="button" disabled={reviewing} onClick={()=>{const current=saved.current;releaseSheet();if(current&&restore(current))onReview();dismiss();}}><Icon name="sparkles"/><span>{uiText("Review with AI")}</span></button>}
      <button type="button" disabled={explaining || !onExplain} onClick={() => { const current = saved.current; releaseSheet(); if (current && restore(current)) onExplain?.(); dismiss(); }}><Icon name="sparkles"/><span>{explanationAction}</span></button>
      <button type="button" onClick={() => { setMore(false); setSemantic(true); }}><Icon name="semantic"/><span>{uiText("Semantic function")}</span><Icon name="chevron"/></button>
      <button type="button" disabled={!single} onClick={() => { setMore(false); setAnnotating(true); setLinking(false); setQuery(''); setAliasError(''); }}><Icon name="knowledge"/><span>{uiText("Annotate selection")}</span><Icon name="chevron"/></button>
    </div>}
    {semantic && <div className="semantic-picker" role="region" aria-label={uiText("Semantic functions")}><p>{selectedCount===1 ? uiText("Apply a function to this block") : uiText("Group selected blocks under one function")}</p>{editableSemanticKinds.map(kind=><button type="button" key={kind} onClick={()=>{const range=saved.current;releaseSheet();if(range&&restore(range))onSemantic(kind);dismiss();}}><span style={{color:semanticFunctions[kind].color}}><Icon name={semanticFunctions[kind].icon}/></span><span>{uiText(semanticFunctions[kind].label)}<small>{uiText(semanticFunctions[kind].description)}</small></span></button>)}</div>}
    {annotating && <div className="selection-entities" role="region" aria-label={uiText("Annotate selection")} aria-busy={savingAlias}>
      {savingAlias && <p role="status">{uiText("Saving alias…")}</p>}
      {aliasError && <p role="alert">{aliasError}</p>}
      <input autoFocus aria-label={uiText("Search knowledge entities")} placeholder={uiText("Find an existing entity…")} value={query} onChange={event => setQuery(event.target.value)}/>
      <div className="selection-entity-results">
        {results.map(entity => <button type="button" key={entity.id} disabled={savingAlias} onClick={() => void linkEntity(entity.id)}><Icon name={entity.type}/><span>{entity.name}<small>{uiText(entityLabels[entity.type])}{exact.some(item=>item.id===entity.id)?' · Exact match':''}</small></span></button>)}
        {!results.length && <div className="selection-empty">{uiText("No matching entities")}</div>}
      </div>
      {!query&&<p>{uiText("Linking preserves the highlighted text and saves it as an alias for future tagging.")}</p>}
      <button type="button" className="selection-create" onClick={createFromSelection}><Icon name="plus"/><span>{uiText("Add “")}{selectedText.length > 60 ? selectedText.slice(0, 60) + '…' : selectedText}{uiText("” as new entity")}</span></button>
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
      <div className="selection-toolbar" role="toolbar" aria-label={uiText("Selection formatting")} aria-orientation="horizontal">
        {(mobile ? formats.slice(0, 3) : formats).map(format => <button key={format.command} type="button" title={`${format.label} (${textFormatShortcuts[format.command]})`} aria-label={format.label} aria-pressed={active.includes(format.command)} disabled={!range || !editor.current || !editorSelectionRanges(editor.current,range).length} onClick={() => applyFormat(format.command)}>{format.glyph}</button>)}
        {!mobile && <>
        <button type="button" aria-label={uiText("Inline equation")} title={uiText("Inline equation")} disabled={!single} onClick={() => {const current = saved.current?.cloneRange(); if (current) {dismiss(); onMath(current);}}}><Icon name="equation"/></button>
        <span className="selection-divider"/>
        {onReview&&<button type="button" aria-label={uiText("Review with AI")} title={uiText("Review with AI")} disabled={reviewing} onClick={()=>{const current=saved.current;if(current&&restore(current))onReview();dismiss();}}><Icon name="sparkles"/><span className="selection-action-label">{uiText("Review")}</span></button>}
        <button type="button" aria-label={explanationAction} title={explanationAction} disabled={explaining || !onExplain} onClick={()=>{const range=saved.current;if(range&&restore(range))onExplain?.();dismiss();}}><Icon name="sparkles"/><span className="selection-action-label">{explanationAction}</span></button>
        <button type="button" className="selection-semantic" title={uiText("Apply a semantic function")} aria-expanded={semantic} aria-haspopup={mobile ? 'dialog' : undefined} aria-label={uiText("Semantic block function")} onClick={()=>{picking.current=!semantic;setSemantic(!semantic);setAnnotating(false);setLinking(false);}}><Icon name="semantic"/><span className="selection-action-label">{uiText("Semantic")}</span></button>
        <button type="button" className="selection-annotate" disabled={!single} aria-label={uiText("Annotate selection")} title={single ? uiText("Connect selection to a knowledge entity") : uiText("Select text within one block or table cell to annotate")} aria-haspopup={mobile ? 'dialog' : undefined} aria-expanded={annotating} onClick={() => { picking.current = !annotating; setSemantic(false); setAnnotating(!annotating); setLinking(false); setQuery(''); setAliasError(''); }}><Icon name="knowledge"/><span className="selection-action-label">{uiText("Annotate")}</span></button>
        </>}
        {mobile && <button type="button" aria-label={uiText("More text actions")} title={uiText("More text actions")} aria-haspopup="dialog" aria-expanded={more || semantic || annotating} onClick={() => { picking.current = true; setMore(true); setSemantic(false); setAnnotating(false); setLinking(false); }}><Icon name="more"/></button>}
      </div>
      {mobile && <button type="button" className="selection-done" aria-label={uiText("Finish text selection")} title={uiText("Finish text selection")} onClick={() => {
        const current = saved.current?.cloneRange();
        if (current && editor.current) {
          const end = editorSelectionRanges(editor.current, current).at(-1)?.cloneRange();
          if (end) { end.collapse(false); restore(end); }
        }
        dismiss();
      }}><Icon name="check"/></button>}
    </div>
    {mobile && (more || semantic || annotating) ? <Modal className="mobile-selection-sheet" titleId="mobile-selection-sheet-title" onClose={closePicker} dismissOnBackdrop>
      <ModalHeader titleId="mobile-selection-sheet-title" actions={!more&&<button type="button" className="selection-picker-back" aria-label="Back to text actions" onClick={() => { setMore(true); setSemantic(false); setAnnotating(false); setLinking(false); }}><Icon name="chevron"/></button>} closeLabel={uiText("Back to selection")}>{more ? uiText("Text actions") : semantic ? uiText("Semantic function") : uiText("Annotate selection")}</ModalHeader>
      <p className="mobile-selection-preview">{selectedText.length > 120 ? selectedText.slice(0, 120) + '…' : selectedText}</p>
      {picker}
    </Modal> : picker}
  </div>;
}
