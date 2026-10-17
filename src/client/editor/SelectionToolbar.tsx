import { semanticFunctions, editableSemanticKinds, type SemanticKind } from '../../shared/semantic-blocks';
import { editorSelectionRanges, selectedEditorBlocks } from './block-selection';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { entityLabels, type Entity } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { annotationSuggestions, selectionPopoverPlacement } from './selection-annotation';
import { segmentHTML } from './segments';

interface Props {
  onExplain?: () => void;
  explaining?: boolean;
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
export function SelectionToolbar({editor, entities, onCommit, onAddAlias, onCreateEntity, onMath, onSemantic, onExplain, explaining}: Props) {
  const [anchor, setAnchor] = useState<{left: number; right: number; top: number; bottom: number} | null>(null);
  const [annotating, setAnnotating] = useState(false), [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [linking, setLinking] = useState(false);
  const [savingAlias, setSavingAlias] = useState(false), [aliasError, setAliasError] = useState('');
  const [active, setActive] = useState<string[]>([]);
  const [position, setPosition] = useState<{left: number; top: number; maxHeight?: number}>({left: 0, top: 0});
  const saved = useRef<Range | null>(null), surface = useRef<HTMLDivElement>(null);
  const picking = useRef(false);
  const latest = useRef({entities, onCommit}); latest.current = {entities, onCommit};
  function dismiss() { saved.current = null; picking.current = false; setSemantic(false); setAnnotating(false); setLinking(false); setAnchor(null); }
  useEffect(() => {
    function inspect() {
      if (picking.current || surface.current?.contains(document.activeElement)) return;
      const selection = getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) { dismiss(); return; }
      const range = selection.getRangeAt(0);
      const portions = editor.current ? editorSelectionRanges(editor.current, range) : [];
      const start = editable(range.startContainer) ?? (portions[0] ? editable(portions[0].startContainer) : undefined);
      const end = editable(range.endContainer) ?? (portions.at(-1) ? editable(portions.at(-1)!.endContainer) : undefined);
      const selectedBlocks=editor.current ? selectedEditorBlocks(editor.current,selection) : null;
      if (!selectedBlocks || (start && !editor.current?.contains(start)) || (end && !editor.current?.contains(end))) { dismiss(); return; }
      // Entity references are atomic; do not offer annotation inside an existing reference.
      const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      if (parent?.closest('[data-entity],[data-math]')) { dismiss(); return; }
      const box = range.getBoundingClientRect();
      if (!box.width && !box.height) { dismiss(); return; }
      saved.current = range.cloneRange();
      setActive(formats.filter(format => document.queryCommandState(format.command)).map(format => format.command));
      setAnchor({left: box.left, right: box.right, top: box.top, bottom: box.bottom});
    }
    function outside(event: PointerEvent) {
      if (surface.current?.contains(event.target as Node)) return;
      dismiss();
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || !saved.current) return;
      const range = saved.current;
      if (!editable(range.endContainer) && editor.current) {
        const end = editorSelectionRanges(editor.current, range).at(-1);
        if (end) range.setEnd(end.endContainer, end.endOffset);
      }
      range.collapse(false);
      dismiss();
      editable(range.startContainer)?.focus();
      getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
      event.preventDefault();
    }
    const hideOnScroll = (event: Event) => { if (!surface.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener('selectionchange', inspect);
    document.addEventListener('pointerup', inspect);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', hideOnScroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('selectionchange', inspect);
      document.removeEventListener('pointerup', inspect);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', hideOnScroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [editor]);
  useLayoutEffect(() => {
    if (!anchor || !surface.current) return;
    const box = surface.current.getBoundingClientRect();
    setPosition(selectionPopoverPlacement(anchor, {width: box.width, height: surface.current.scrollHeight + 2}, {width: innerWidth, height: innerHeight}));
  }, [anchor, annotating, semantic, linking, query, entities]);
  function restore(range: Range) {
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return false;
    editable(range.startContainer)?.focus();
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    return true;
  }
  function applyFormat(command: string) {
    const range = saved.current;
    if (!range || !restore(range)) { dismiss(); return; }
    const ranges = editor.current ? editorSelectionRanges(editor.current, range) : [];
    const original = range.cloneRange();
    const enable = !ranges.every(part => {restore(part); return document.queryCommandState(command);});
    for (const part of ranges) { if (restore(part) && document.queryCommandState(command) !== enable) document.execCommand(command); }
    restore(original);
    latest.current.onCommit();
    const selection = getSelection();
    if (selection?.rangeCount) saved.current = selection.getRangeAt(0).cloneRange();
    setActive(formats.filter(item => document.queryCommandState(item.command)).map(item => item.command));
  }
  function connect(range: Range, text: string, id: string) {
    // A create dialog may outlive an edit or page navigation. Never replace stale text.
    if (!range.startContainer.isConnected || !range.endContainer.isConnected || range.toString() !== text || !editor.current?.contains(range.commonAncestorContainer)) return false;
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
  const selectedCount = range && editor.current ? new Set(editorSelectionRanges(editor.current,range).map(part=>editable(part.startContainer)?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId)).size : 0;
  const lockedSemantic = range && editor.current ? selectedEditorBlocks(editor.current)?.elements.some(el=>el.dataset.semanticKind==='ai-explanation'||el.closest('[data-block-group-id]')?.getAttribute('data-semantic-kind')==='ai-explanation') : false;
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
  return <div ref={surface} className="selection-popover" style={position} onMouseDown={event => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }}>
    <div className="selection-toolbar" role="toolbar" aria-label="Selection formatting">
      {formats.map(format => <button key={format.command} type="button" title={format.label} aria-label={format.label} aria-pressed={active.includes(format.command)} disabled={!range || !editor.current || !editorSelectionRanges(editor.current,range).length} onClick={() => applyFormat(format.command)}>{format.glyph}</button>)}
      <button type="button" aria-label="Inline equation" title="Inline equation" disabled={!single} onClick={() => {const current = saved.current?.cloneRange(); if (current) {dismiss(); onMath(current);}}}><Icon name="equation"/></button>
      <button type="button" aria-label="Explain with AI" title="Explain selected blocks with AI" disabled={explaining || !onExplain} onClick={()=>{const range=saved.current;if(range&&restore(range))onExplain?.();dismiss();}}><Icon name="sparkles"/>Explain with AI</button>
      <span className="selection-divider"/>
      <button type="button" className="selection-semantic" disabled={!!lockedSemantic} title={lockedSemantic?'AI Explanation is a permanent tag':'Apply a semantic function'} aria-expanded={semantic} aria-label="Semantic block function" onClick={()=>{picking.current=!semantic;setSemantic(!semantic);setAnnotating(false);setLinking(false);}}><Icon name="semantic"/>Semantic</button>
      <button type="button" className="selection-annotate" disabled={!single} title={single ? 'Connect selection to a knowledge entity' : 'Select text within one block or table cell to annotate'} aria-expanded={annotating} onClick={() => { picking.current = !annotating; setSemantic(false); setAnnotating(!annotating); setLinking(false); setQuery(''); }}><Icon name="knowledge"/>Annotate</button>
    </div>
    {semantic && <div className="semantic-picker" role="region" aria-label="Semantic functions"><p>{selectedCount===1 ? 'Apply a function to this block' : 'Group selected blocks under one function'}</p>{editableSemanticKinds.map(kind=><button type="button" key={kind} onClick={()=>{const range=saved.current;if(range&&restore(range))onSemantic(kind);dismiss();}}><span style={{color:semanticFunctions[kind].color}}><Icon name={semanticFunctions[kind].icon}/></span><span>{semanticFunctions[kind].label}<small>{semanticFunctions[kind].description}</small></span></button>)}</div>}
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
  </div>;
}
