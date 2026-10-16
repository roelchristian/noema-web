import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { entityLabels, type Entity } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { segmentHTML } from './segments';

interface Props {
  editor: RefObject<HTMLDivElement | null>;
  entities: Entity[];
  onCommit: () => void;
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
export function SelectionToolbar({editor, entities, onCommit, onCreateEntity}: Props) {
  const [anchor, setAnchor] = useState<{left: number; top: number; bottom: number} | null>(null);
  const [annotating, setAnnotating] = useState(false), [query, setQuery] = useState('');
  const [active, setActive] = useState<string[]>([]);
  const [position, setPosition] = useState({left: 0, top: 0});
  const saved = useRef<Range | null>(null), surface = useRef<HTMLDivElement>(null);
  const picking = useRef(false);
  const latest = useRef({entities, onCommit}); latest.current = {entities, onCommit};
  function dismiss() { saved.current = null; picking.current = false; setAnnotating(false); setAnchor(null); }
  useEffect(() => {
    function inspect() {
      if (picking.current || surface.current?.contains(document.activeElement)) return;
      const selection = getSelection();
      if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) { dismiss(); return; }
      const range = selection.getRangeAt(0), start = editable(range.startContainer), end = editable(range.endContainer);
      if (!start || !end || !editor.current?.contains(start) || !editor.current.contains(end)) { dismiss(); return; }
      // Entity references are atomic; do not offer annotation inside an existing reference.
      const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      if (parent?.closest('[data-entity]')) { dismiss(); return; }
      const box = range.getBoundingClientRect();
      if (!box.width && !box.height) { dismiss(); return; }
      saved.current = range.cloneRange();
      setActive(formats.filter(format => document.queryCommandState(format.command)).map(format => format.command));
      setAnchor({left: box.left + box.width / 2, top: box.top, bottom: box.bottom});
    }
    function outside(event: PointerEvent) {
      if (surface.current?.contains(event.target as Node)) return;
      dismiss();
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || !saved.current) return;
      const range = saved.current;
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
    setPosition({left: Math.max(8, Math.min(anchor.left - box.width / 2, innerWidth - box.width - 8)), top: Math.max(8, Math.min(anchor.top >= box.height + 16 ? anchor.top - box.height - 8 : anchor.bottom + 8, innerHeight - box.height - 8))});
  }, [anchor, annotating, query, entities]);
  function restore(range: Range) {
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return false;
    editable(range.startContainer)?.focus();
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    return true;
  }
  function applyFormat(command: string) {
    const range = saved.current;
    if (!range || !restore(range)) { dismiss(); return; }
    document.execCommand(command);
    latest.current.onCommit();
    const selection = getSelection();
    if (selection?.rangeCount) saved.current = selection.getRangeAt(0).cloneRange();
    setActive(formats.filter(item => document.queryCommandState(item.command)).map(item => item.command));
  }
  function connect(range: Range, text: string, id: string) {
    // A create dialog may outlive an edit or page navigation. Never replace stale text.
    if (!range.startContainer.isConnected || !range.endContainer.isConnected || range.toString() !== text || !editor.current?.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const wrapper = document.createElement('span');
    wrapper.innerHTML = segmentHTML([{entityId: id}], latest.current.entities);
    const mention = wrapper.firstChild!; range.insertNode(mention);
    range.setStartAfter(mention); range.collapse(true); restore(range);
    latest.current.onCommit(); dismiss();
  }
  if (!anchor) return null;
  const range = saved.current;
  const single = range && editable(range.startContainer) === editable(range.endContainer);
  const matches = entities.filter(entity => entity.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 20);
  return <div ref={surface} className="selection-popover" style={position} onMouseDown={event => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }}>
    <div className="selection-toolbar" role="toolbar" aria-label="Selection formatting">
      {formats.map(format => <button key={format.command} type="button" title={format.label} aria-label={format.label} aria-pressed={active.includes(format.command)} onClick={() => applyFormat(format.command)}>{format.glyph}</button>)}
      <span className="selection-divider"/>
      <button type="button" className="selection-annotate" disabled={!single} title={single ? 'Connect selection to a knowledge entity' : 'Select text within one block or table cell to annotate'} aria-expanded={annotating} onClick={() => { picking.current = !annotating; setAnnotating(!annotating); setQuery(''); }}><Icon name="knowledge"/>Annotate</button>
    </div>
    {annotating && <div className="selection-entities" role="region" aria-label="Annotate selection">
      <input autoFocus aria-label="Search knowledge entities" placeholder="Search knowledge entities…" value={query} onChange={event => setQuery(event.target.value)}/>
      <p>Replace selection with an entity reference</p>
      <div className="selection-entity-results">
        {matches.map(entity => <button type="button" key={entity.id} onClick={() => { const current = saved.current; if (current) connect(current.cloneRange(), current.toString(), entity.id); }}><Icon name={entity.type}/><span>{entity.name}<small>{entityLabels[entity.type]}</small></span></button>)}
        {!matches.length && <div className="selection-empty">No matching entities</div>}
      </div>
      <button type="button" className="selection-create" onClick={() => {
        const current = saved.current?.cloneRange(); if (!current) return;
        const text = current.toString();
        dismiss();
        onCreateEntity((query.trim() || text.trim()).slice(0, 200), id => connect(current, text, id));
      }}><Icon name="plus"/><span>Create entity from selection</span></button>
    </div>}
  </div>;
}
