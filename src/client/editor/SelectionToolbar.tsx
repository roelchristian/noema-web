import {t as uiText} from '../i18n';
import { semanticFunctions, editableSemanticKinds, type SemanticKind } from '../../shared/semantic-blocks';
import { clearEditorSelection, editorSelectionRange, editorSelectionRanges, selectedEditorBlocks } from './block-selection';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { entityLabels, type Entity } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Modal, ModalHeader } from '../components/Modal';
import { EntityResolutionPicker } from './EntityResolutionPicker';
import { selectionPopoverPlacement, selectionActionPlacement } from './selection-annotation';
import type { MentionMatchOptions } from './mention-picker';
import { segmentHTML } from './segments';
import {applyEditorTextFormat,textFormatShortcuts,type TextFormat} from './text-formatting';

interface Props {
  mobile?: boolean;
  keyboardInset?: number;
  viewportHeight?: number;
  onRead?: () => void;
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
  onOpenEntity: (id:string) => void;
  onAddAlias: (id: string, alias: string) => Promise<void>;
  onMath: (range: Range) => void;
  onCreateEntity: (name: string, onCreated: (id: string) => void, onCancel?: () => void) => void;
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
export function SelectionToolbar({mobile = false, keyboardInset = 0, viewportHeight, editor, entities, suggestionContext, onCommit, onAddAlias, onOpenEntity, onCreateEntity, onMath, onSemantic, onExplain, explaining, explainLabel, onReview, reviewing, onRead}: Props) {
  const [anchor, setAnchor] = useState<{left: number; right: number; top: number; bottom: number} | null>(null);
  const [annotating, setAnnotating] = useState(false), [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [more, setMore] = useState(false);
  const [reuseAlias, setReuseAlias] = useState(false);
  const [savingAlias, setSavingAlias] = useState(false), [aliasError, setAliasError] = useState('');
  const [active, setActive] = useState<string[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const explanationAction = explainLabel?.(selectedIds) ?? 'Explain with AI';
  const [position, setPosition] = useState<{left: number; top: number; maxHeight?: number}>({left: 0, top: 0});
  const saved = useRef<Range | null>(null), surface = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null), moreTrigger = useRef<HTMLButtonElement>(null), linkTrigger = useRef<HTMLButtonElement>(null);
  const panelId = useId(), pickerOrigin = useRef<'more' | 'link'>('more');
  const focusAction = useRef<string | null>(null);
  const picking = useRef(false), operation = useRef(0);
  const [aliasRecovery,setAliasRecovery]=useState<{id:string;message:string}|null>(null);
  const latest = useRef({entities, onCommit}); latest.current = {entities, onCommit};
  function releaseSheet() { surface.current?.querySelector<HTMLDialogElement>('.mobile-selection-sheet')?.close(); }
  function dismiss() { operation.current++; releaseSheet(); saved.current = null; picking.current = false; setMore(false); setSemantic(false); setAnnotating(false); setAnchor(null); }
  function closePicker(focusTrigger = false) {
    operation.current++; releaseSheet(); picking.current = false; setMore(false); setSemantic(false); setAnnotating(false);
    if (saved.current && !restore(saved.current)) { dismiss(); return; }
    if (focusTrigger) (pickerOrigin.current === 'link' ? linkTrigger : moreTrigger).current?.focus({preventScroll:true});
  }
  function showPicker(kind: 'more' | 'semantic' | 'link') {
    if (annotating && kind !== 'link') operation.current++;
    picking.current = true;
    setMore(kind === 'more'); setSemantic(kind === 'semantic'); setAnnotating(kind === 'link');
    focusAction.current = kind === 'link' ? null : 'first';
    if (kind === 'link') { setQuery(''); setAliasError(''); setReuseAlias(false);  }
  }
  function backToActions() {
    showPicker('more'); focusAction.current = 'semantic';
  }
  function panelKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' || (semantic && event.key === 'ArrowLeft')) {
      event.preventDefault(); event.stopPropagation();
      if (semantic) backToActions(); else closePicker(true);
      return;
    }
    if (event.key === 'Tab' && !mobile && (more || semantic)) { event.stopPropagation(); closePicker(true); return; }
    if ((event.target as HTMLElement).closest('input,textarea,select')) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-selection-action]:not(:disabled)')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let target: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') target = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    else if (event.key === 'Home' || event.key === 'End') target = event.key === 'Home' ? items[0] : items.at(-1);
    else if (event.key === 'ArrowRight' && (event.target as HTMLElement).closest('[data-selection-action="semantic"]')) {event.preventDefault();showPicker('semantic');return;}
    if (target) { event.preventDefault(); target.focus({preventScroll:true}); target.scrollIntoView({block:'nearest'}); }
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
      if (event.isComposing) return;
      if (event.altKey && event.key === 'F10' && saved.current) {
        event.preventDefault(); surface.current?.querySelector<HTMLButtonElement>('.selection-toolbar button:not(:disabled)')?.focus({preventScroll:true}); return;
      }
      if (event.key !== 'Escape' || !saved.current) return;
      if (picking.current) { closePicker(true); event.preventDefault(); return; }
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
    function reposition() {
      const range = saved.current;
      if (!range) return;
      if (!range.startContainer.isConnected || !range.endContainer.isConnected || !editor.current?.contains(range.commonAncestorContainer)) { dismiss(); return; }
      const box = range.getBoundingClientRect();
      setAnchor({left:box.left,right:box.right,top:box.top,bottom:box.bottom});
    }
    const hideOnScroll = (event: Event) => { if (!surface.current?.contains(event.target as Node)) reposition(); };
    const resize = () => reposition();
    const root=editor.current;
    root?.addEventListener('noema:editor-selection',scheduleInspect);
    document.addEventListener('selectionchange', scheduleInspect);
    document.addEventListener('pointerup', scheduleInspect);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', hideOnScroll, true);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
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
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, [editor, mobile]);
  useLayoutEffect(() => {
    if (mobile || !anchor || !surface.current) return;
    const box = surface.current.getBoundingClientRect();
    const next = selectionPopoverPlacement(anchor, {width: box.width, height: box.height}, {width: innerWidth, height: innerHeight});
    setPosition(previous => previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight ? previous : next);
  }, [mobile, anchor]);
  useLayoutEffect(() => {
    if (mobile || !anchor || !panel.current) return;
    const popup = panel.current, trigger = (annotating ? linkTrigger : moreTrigger).current;
    if (!trigger) return;
    popup.style.maxHeight = 'none';
    const box = popup.getBoundingClientRect();
    const next = selectionActionPlacement(anchor, trigger.getBoundingClientRect(), {width:box.width,height:popup.scrollHeight + 2}, {width:innerWidth,height:innerHeight});
    popup.style.left = `${next.left}px`; popup.style.top = `${next.top}px`; popup.style.maxHeight = `${next.maxHeight}px`;
  }, [mobile, anchor, position, more, semantic, annotating, query, entities, aliasError, savingAlias, reuseAlias]);
  useLayoutEffect(() => {
    const target = focusAction.current;
    if (!target || !panel.current) return;
    focusAction.current = null;
    const items = panel.current.querySelectorAll<HTMLButtonElement>('[data-selection-action]:not(:disabled)');
    const item = target === 'semantic' ? panel.current.querySelector<HTMLButtonElement>('[data-selection-action="semantic"]') : items[0];
    item?.focus({preventScroll:true});
  }, [more, semantic, annotating, mobile]);
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
    wrapper.innerHTML = segmentHTML([{entityId: id, mentionText: text, skipAutoTag:true}], latest.current.entities);
    const mention = wrapper.firstChild!; range.insertNode(mention);
    range.setStartAfter(mention); range.collapse(true); restore(range);
    latest.current.onCommit(); dismiss();
    return true;
  }
  const recovery=aliasRecovery&&<div className="entity-alias-recovery" role="status"><span>{aliasRecovery.message}</span><button type="button" onClick={()=>onOpenEntity(aliasRecovery.id)}>Manage entity aliases</button><button type="button" onClick={()=>setAliasRecovery(null)}>Dismiss</button></div>;
  if (!anchor) return recovery;
  const range = saved.current;
  const single = range && editor.current && editorSelectionRanges(editor.current, range).length === 1;
  const selectedText = range?.toString().trim() || '';
  const linkEntity = async (id: string) => {
    const current = saved.current;
    if (!current || savingAlias) return;
    const range = current.cloneRange(), text = current.toString();
    if (!range.startContainer.isConnected || !range.endContainer.isConnected || range.toString() !== text || !editor.current?.contains(range.commonAncestorContainer)) {setAliasError('The selected text changed. Select it again.'); return;}
    if (!reuseAlias) {if(!connect(range,text,id))setAliasError('The selected text changed. Select it again.'); return;}
    const token=++operation.current;
    setSavingAlias(true); setAliasError('');
    try {
      await onAddAlias(id,text.trim());
      if (operation.current!==token || !connect(range,text,id)) setAliasRecovery({id,message:'Alias saved in this vault; the selection was cancelled or changed, so no link was added. Manage aliases separately from document undo.'});
      else setAliasRecovery({id,message:'Reusable vault alias saved. Document undo changes this note only; manage aliases separately.'});
    } catch (error) { setAliasError(error instanceof Error ? error.message : String(error)); setAliasRecovery({id,message:'Alias saving failed or could not be confirmed. Check entity aliases before retrying. Document undo does not change aliases.'}); }
    finally { setSavingAlias(false); }
  };
  const createFromSelection = () => {
    const current = saved.current?.cloneRange(); if (!current) return;
    const text = current.toString();
    dismiss();
    onCreateEntity(text.trim().slice(0, 200), id => {if(!connect(current,text,id))throw new Error('Entity created, but the selection changed. Select text again to link it.');}, () => {if(current.toString()===text&&editor.current?.contains(current.commonAncestorContainer))restore(current);});
  };
  const picker = <>
    {more && <div className="selection-more-actions menu-primitive" data-menu-size="regular" data-menu-presentation="embedded" role="menu" aria-label={uiText("Text actions")}>
      <div role="group" aria-label={uiText("Text")}>
        <p className="selection-action-group" aria-hidden="true">{uiText("Text")}</p>
        <button type="button" role="menuitemcheckbox" tabIndex={-1} data-selection-action="strike" aria-checked={active.includes('strikeThrough')} title={uiText("Strikethrough ({value0})",{value0: textFormatShortcuts.strikeThrough})} onClick={() => {
          releaseSheet(); picking.current = false; setMore(false); applyFormat('strikeThrough');
        }}><s>S</s><span>{uiText("Strikethrough")}</span><kbd>{textFormatShortcuts.strikeThrough}</kbd></button>
        <button type="button" role="menuitem" tabIndex={-1} data-selection-action="math" disabled={!single} onClick={() => { const current = saved.current?.cloneRange(); if (current) { dismiss(); onMath(current); } }}><Icon name="equation"/><span>{uiText("Inline equation")}</span></button>
      </div>
      <div role="group" aria-label={uiText("Block")}>
        <p className="selection-action-group" aria-hidden="true">{uiText("Block")}</p>
        <button type="button" role="menuitem" tabIndex={-1} data-selection-action="semantic" aria-haspopup="menu" aria-expanded={false} onClick={() => showPicker('semantic')}><Icon name="semantic"/><span>{uiText("Semantic function")}</span><Icon name="chevron"/></button>
      </div>
      <div role="group" aria-label="AI">
        <p className="selection-action-group" aria-hidden="true">AI</p>
        {onReview&&<button type="button" role="menuitem" tabIndex={-1} data-selection-action="review" disabled={reviewing} onClick={()=>{const current=saved.current;releaseSheet();if(current&&restore(current))onReview();dismiss();}}><Icon name="sparkles"/><span>{uiText("Review with AI")}</span></button>}
        <button type="button" role="menuitem" tabIndex={-1} data-selection-action="explain" disabled={explaining || !onExplain} onClick={() => { const current = saved.current; releaseSheet(); if (current && restore(current)) onExplain?.(); dismiss(); }}><Icon name="sparkles"/><span>{explanationAction}</span></button>
      </div>
    </div>}
    {semantic && <div className="semantic-picker menu-primitive" data-menu-size="regular" data-menu-presentation="embedded" role="menu" aria-label={uiText("Semantic functions")}>{!mobile&&<button type="button" role="menuitem" tabIndex={-1} data-selection-action="back" className="selection-picker-back" onClick={backToActions}><Icon name="chevron"/>{uiText("Back to text actions")}</button>}<p>{selectedCount===1 ? uiText("Apply a function to this block") : uiText("Group selected blocks under one function")}</p>{editableSemanticKinds.map(kind=><button type="button" role="menuitem" tabIndex={-1} data-selection-action={kind} key={kind} onClick={()=>{const range=saved.current;releaseSheet();if(range&&restore(range))onSemantic(kind);dismiss();}}><span style={{color:semanticFunctions[kind].color}}><Icon name={semanticFunctions[kind].icon}/></span><span>{uiText(semanticFunctions[kind].label)}<small>{uiText(semanticFunctions[kind].description)}</small></span></button>)}</div>}
    {annotating && <div className="selection-entities" role="region" aria-label={uiText("Link entity")} aria-busy={savingAlias}>
      {savingAlias && <p role="status">{uiText("Saving alias…")}</p>}
      {aliasError && <p role="alert">{aliasError}</p>}
      <EntityResolutionPicker entities={entities} selection={selectedText} options={suggestionContext} disabled={savingAlias} onChoose={entity=>void linkEntity(entity.id)} query={query} onQuery={setQuery} idPrefix="selection-entity" autoFocus/>
      <label className="selection-alias-option"><input type="checkbox" checked={reuseAlias} disabled={savingAlias} onChange={event=>setReuseAlias(event.target.checked)}/>{uiText("Save highlighted wording as a reusable vault alias")}</label>
      <p>{reuseAlias ? uiText("Aliases affect future matching across this vault. Manage them in entity details; document undo only changes this note.") : uiText("Link only this occurrence and preserve your wording.")}</p>
      <button type="button" className="selection-create" disabled={savingAlias} onClick={createFromSelection}><Icon name="plus"/><span>{uiText("Add “")}{selectedText.length > 60 ? selectedText.slice(0, 60) + '…' : selectedText}{uiText("” as new entity")}</span></button>
    </div>}
  </>;
  return <>{recovery}<div ref={surface} className={'selection-popover selection-context' + (mobile ? ' mobile-selection-popover' : '')}
    data-keyboard-open={keyboardInset > 0 ? true : undefined}
    style={mobile ? {bottom: keyboardInset, '--selection-keyboard-inset': `${keyboardInset}px`, '--selection-viewport-height': `${viewportHeight ?? window.innerHeight}px`} as CSSProperties : position}
    onPointerDown={event => {
      // Keep native selection and the keyboard when tapping toolbar buttons.
      if (mobile && !(event.target as Element).closest('dialog') && (event.target as Element).closest('button')) event.preventDefault();
    }}
    onMouseDown={event => { if (!(event.target instanceof HTMLInputElement) && !(event.target as Element).closest('dialog')) event.preventDefault(); }}>
    <div className="selection-toolbar-row">
      <div className="selection-toolbar" role="toolbar" aria-label={uiText("Selection formatting")} aria-orientation="horizontal" aria-keyshortcuts="Alt+F10" onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const target = event.key === 'Home' ? items[0] : event.key === 'End' ? items.at(-1) : items[(index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
        event.preventDefault(); target?.focus({preventScroll:true});
      }}>
        {formats.slice(0, 3).map(format => <button key={format.command} type="button" title={`${format.label} (${textFormatShortcuts[format.command]})`} aria-label={format.label} aria-pressed={active.includes(format.command)} disabled={!range || !editor.current || !editorSelectionRanges(editor.current,range).length} onClick={() => applyFormat(format.command)}>{format.glyph}</button>)}
        <span className="selection-divider"/>
        {onRead && <button type="button" aria-label={uiText("Read")} title={uiText("Read aloud with an AI-generated voice")} onClick={() => {
          const current = saved.current; releaseSheet();
          if (current && restore(current)) onRead();
          dismiss();
        }}><Icon name="speaker"/></button>}
        <button ref={linkTrigger} type="button" className="selection-annotate" disabled={!single || savingAlias} aria-label={uiText("Link entity")} title={single ? uiText("Connect selection to a knowledge entity") : uiText("Select text within one block or table cell to annotate")} aria-haspopup="dialog" aria-controls={annotating ? panelId : undefined} aria-expanded={annotating} onClick={() => {
          if (annotating) closePicker(); else {pickerOrigin.current = 'link';showPicker('link');}
        }}><Icon name="knowledge"/><span className="selection-action-label">{uiText("Link entity")}</span></button>
        <button ref={moreTrigger} type="button" className="selection-more-trigger" aria-label={uiText("Text actions")} title={uiText("Text actions")} aria-haspopup={mobile ? 'dialog' : 'menu'} aria-controls={more || semantic ? panelId : undefined} aria-expanded={more || semantic} onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); pickerOrigin.current = 'more';
            if (more) panel.current?.querySelector<HTMLButtonElement>('[data-selection-action]:not(:disabled)')?.focus({preventScroll:true});
            else showPicker('more');
          }
        }} onClick={() => {
          if (more || semantic) closePicker(); else {pickerOrigin.current = 'more';showPicker('more');}
        }}>{mobile ? <Icon name="more"/> : <>{uiText("Text actions")}<Icon name="chevron"/></>}</button>
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
    {mobile && (more || semantic || annotating) ? <Modal className="mobile-selection-sheet" titleId="mobile-selection-sheet-title" onClose={() => closePicker()} dismissOnBackdrop initialFocus={annotating ? 'input' : '[data-selection-action]:not(:disabled)'}>
      <ModalHeader titleId="mobile-selection-sheet-title" actions={!more&&<button type="button" className="selection-picker-back" aria-label="Back to text actions" onClick={backToActions}><Icon name="chevron"/></button>} closeLabel={uiText("Back to selection")}>{more ? uiText("Text actions") : semantic ? uiText("Semantic function") : uiText("Link entity")}</ModalHeader>
      <p className="mobile-selection-preview">{selectedText.length > 120 ? selectedText.slice(0, 120) + '…' : selectedText}</p>
      <div ref={panel} id={panelId} onKeyDown={panelKeys}>{picker}</div>
    </Modal> : (more || semantic || annotating) && <div ref={panel} id={panelId} className="selection-actions-panel" role={annotating ? 'dialog' : undefined} aria-label={annotating ? uiText("Link entity") : undefined} onKeyDown={panelKeys}>{picker}</div>}
  </div></>;
}
