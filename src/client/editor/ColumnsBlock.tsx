import {useRef, type ClipboardEvent} from 'react';
import {blockSegments, type Block, type Entity, type Segment} from '../../shared/domain';
import type {EntityReviewItem} from '../../shared/entity-match-cache';
import {Cell} from './TableBlock';
import {clipboardBlocks} from './paste';
import {readSegments, segmentHTML} from './segments';

export function ColumnsBlock({block, entities, reviewMatches, onChange, onOpen, onSave, onExit, register}: {
  block: Block; entities: Entity[]; reviewMatches: EntityReviewItem[];
  onChange: (rows: Segment[][][]) => void; onOpen: (id: string) => void;
  onSave: () => void; onExit: () => void; register: (el: HTMLDivElement | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const columns = block.rows?.[0] ?? [[], []];
  function changeColumn(index: number, content: Segment[]) {
    onChange([columns.map((column, position) => position === index ? content : column)]);
  }
  function paste(event: ClipboardEvent<HTMLDivElement>, index: number) {
    event.preventDefault();
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
    const incoming = clipboardBlocks(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html'));
    const content = incoming.flatMap((block, position) => [...(position ? [{text: '\n'}] : []), ...blockSegments(block)]);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = segmentHTML(content, entities);
    const fragment = document.createDocumentFragment();
    while (wrapper.firstChild) fragment.append(wrapper.firstChild);
    const last = fragment.lastChild;
    range.deleteContents(); range.insertNode(fragment);
    if (last) range.setStartAfter(last);
    range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    changeColumn(index, readSegments(event.currentTarget));
  }
  return <div className="columns-block" ref={root} role="group" aria-label="Two columns">
    {columns.map((content, index) => <div className="column-pane" key={index}>
      <Cell label={index === 0 ? 'Left column' : 'Right column'} content={content} entities={entities}
        location={{blockId: block.id, row: 0, col: index, matches: reviewMatches}}
        register={index === 0 ? register : undefined} onOpen={onOpen}
        onChange={content => changeColumn(index, content)} onPaste={event => paste(event, index)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if ((event.metaKey || event.ctrlKey) && event.key === 's') {event.preventDefault(); onSave();}
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {event.preventDefault(); onExit();}
          if (event.key === 'Tab') {
            const next = root.current?.querySelectorAll<HTMLElement>('.block-content')[index + (event.shiftKey ? -1 : 1)];
            if (next) {event.preventDefault(); next.focus();}
          }
        }}/>
    </div>)}
  </div>;
}
