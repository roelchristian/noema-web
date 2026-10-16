import {useEffect,useRef,useState, type KeyboardEvent} from 'react';
import type {Entity,PageSummary} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {PageIcon} from '../components/PageIcon';
import {Modal} from '../components/Modal';
import {combinedMatches} from './matches';
import {useSemanticSearch} from './useSemanticSearch';
import {HighlightedText} from './HighlightedText';
import {useSearchSnippets} from './useSearchSnippets';
import {makeSearchSnippet} from '../../shared/search-snippets';
export function SearchPanel({vaultId,pages,entities,onOpenPage,onOpenEntity,onClose}:{vaultId:string;pages:PageSummary[];entities:Entity[];onOpenPage:(id:string)=>void;onOpenEntity:(id:string)=>void;onClose:()=>void}) {
  const [query,setQuery]=useState(''), [selected,setSelected]=useState<string | null>(null);
  const input=useRef<HTMLInputElement>(null), buttons=useRef(new Map<string,HTMLButtonElement>());
  const semantic=useSemanticSearch(vaultId,query),term=query.trim().toLowerCase();
  useEffect(()=>{input.current?.focus();},[]);
  const scores=new Map(semantic.results.map(result=>[result.id,result.score]));
  const matches=combinedMatches([...pages.map(page=>({id:page.id,name:page.title||'Untitled',kind:'page' as const,icon:page.icon})),...entities.map(entity=>({id:entity.id,name:entity.name,kind:'entity' as const,icon:null}))],query,semantic.results);
  const visible=term ? matches : matches.filter(item=>item.kind==='page').slice(0,6);
  const keyFor=(item:typeof matches[number])=>item.kind+'-'+item.id;
  const selectedIndex=Math.max(0,visible.findIndex(item=>keyFor(item)===selected)),active=visible[selectedIndex],activeId=active ? keyFor(active) : undefined;
  useEffect(()=>{if(activeId) buttons.current.get(activeId)?.scrollIntoView({block:'nearest'});},[activeId,selectedIndex]);
  const semanticNotes=new Map(semantic.results.map(result=>[result.id,result]));
  const previews=useSearchSnippets(vaultId,query,(term?matches:[]).filter(item=>item.kind==='page'&&!semanticNotes.get(item.id)?.snippet).map(item=>item.id));
  const entityDescriptions=new Map(entities.map(entity=>[entity.id,entity.description]));
  function open(item:typeof matches[number]) {if(item.kind==='page') onOpenPage(item.id); else onOpenEntity(item.id);}
  function keyDown(event:KeyboardEvent<HTMLDivElement>) {
    if(event.nativeEvent.isComposing) return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k') {event.preventDefault();event.stopPropagation();onClose();return;}
    if(event.target!==input.current) return;
    if((event.key==='ArrowDown'||event.key==='ArrowUp')&&visible.length) {
      event.preventDefault();
      const next=(selectedIndex+(event.key==='ArrowDown'?1:-1)+visible.length)%visible.length;
      setSelected(keyFor(visible[next]!));
    }
    if(event.key==='Enter'&&active) {event.preventDefault();open(active);}
  }
  return <Modal className="vault-search-dialog" titleId="vault-search-title" onClose={onClose} dismissOnBackdrop>
    <div className="spotlight-search" onKeyDown={keyDown}>
      <h2 id="vault-search-title" className="sr-only">Search vault</h2>
      <div className="spotlight-search-input"><Icon name="search"/><input ref={input} autoFocus type="search" role="combobox" aria-label="Search notes and knowledge" aria-autocomplete="list" aria-expanded="true" aria-controls="vault-search-results" aria-activedescendant={activeId ? 'search-result-'+activeId : undefined} autoComplete="off" maxLength={2000} placeholder="Search names or ideas…" value={query} onChange={event=>{setQuery(event.target.value);setSelected(null);}}/>{semantic.loading&&<span className="scan-spinner" aria-label="Searching"/>}<button className="spotlight-close" aria-label="Close search" title="Close search (Esc)" onClick={onClose}><Icon name="close"/></button></div>
      <div className="spotlight-search-body">
        <p className="spotlight-results-label" role="status">{!term?'Recently updated pages':semantic.loading?'Finding matches…':`${matches.length} ${matches.length===1?'result':'results'}`}</p>
        {semantic.error&&<p className="search-error" role="status">{semantic.error}</p>}{previews.error&&<p className="search-error" role="status">Some note previews are unavailable. You can still open the results.</p>}
        <ul id="vault-search-results" className="vault-search-results" role="listbox" aria-label="Search results">{visible.map(item=>{
          const key=keyFor(item),text=item.name.toLowerCase().includes(term),meaning=item.kind==='page'&&scores.has(item.id);
          const snippet=term ? item.kind==='page'?previews.snippets[item.id]??semanticNotes.get(item.id)?.snippet??'':makeSearchSnippet(entityDescriptions.get(item.id)??'',query) : '';
          return <li key={key} role="presentation"><button ref={el=>{if(el) buttons.current.set(key,el);else buttons.current.delete(key);}} id={'search-result-'+key} role="option" aria-selected={key===activeId} tabIndex={-1} onPointerMove={()=>setSelected(key)} onMouseDown={event=>event.preventDefault()} onClick={()=>open(item)}>{item.kind==='page'?<PageIcon icon={item.icon}/>:<Icon name="knowledge"/>}<span><strong><HighlightedText text={item.name} query={query}/></strong><small>{item.kind==='page'?'Page':'Knowledge entity'}{term&&` · ${text&&meaning?'Text + semantic':text?'Text match':'Related by meaning'}`}</small>{snippet&&<span className="search-result-snippet"><HighlightedText text={snippet} query={query}/></span>}</span>{key===activeId&&<span className="spotlight-open-hint" aria-hidden="true">↵</span>}</button></li>;
        })}</ul>
        {!visible.length&&!semantic.loading&&<p className="spotlight-empty">{term?'No matches. Try another name or idea.':'Search your pages and knowledge by name or idea.'}</p>}
      </div>
      <footer className="spotlight-search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Open</span><span>Semantic search uses OpenAI</span></footer>
    </div>
  </Modal>;
}
