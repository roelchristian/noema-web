import {citationLocation} from '../../shared/citations';
import type {SourceReference} from '../../shared/domain';
import {useEffect,useRef,useState, type KeyboardEvent} from 'react';
import type {Entity,PageSummary} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {PageIcon} from '../components/PageIcon';
import {Modal} from '../components/Modal';
import {combinedMatches} from './matches';
import {useSemanticSearch} from './useSemanticSearch';
import {useTextSearch} from './useTextSearch';
import {HighlightedText} from './HighlightedText';
import {useSearchSnippets} from './useSearchSnippets';
import {makeSearchSnippet} from '../../shared/search-snippets';
export function SearchPanel({vaultId,pages,entities,onOpenPage,onOpenEntity,onOpenPassage,onClose}:{vaultId:string;pages:PageSummary[];entities:Entity[];onOpenPage:(id:string)=>void;onOpenEntity:(id:string)=>void;onOpenPassage:(reference:SourceReference,trigger?:HTMLElement)=>void;onClose:()=>void}) {
  const [query,setQuery]=useState(''), [selected,setSelected]=useState<string | null>(null);
  const input=useRef<HTMLInputElement>(null), buttons=useRef(new Map<string,HTMLButtonElement>());
  const [semanticSuppressed,setSemanticSuppressed]=useState(false);
  const term=query.trim().toLowerCase();
  const refreshKey=JSON.stringify([pages.map(page=>[page.id,page.title,page.updated_at]),entities.map(entity=>[entity.id,entity.name,entity.aliases,entity.description,entity.updated_at])]);
  const textSearch=useTextSearch(vaultId,query,refreshKey);
  const semantic=useSemanticSearch(vaultId,query,{enabled:!!term&&!textSearch.loading&&!semanticSuppressed,delayMs:600});
  useEffect(()=>{input.current?.focus();},[]);
  const textNotes=new Map(textSearch.results.map(result=>[result.kind+':'+result.id,result]));
  const knownItems=[...pages.map(page=>({id:page.id,name:page.title||'Untitled',kind:'page' as const,icon:page.icon,aliases:[] as string[]})),...entities.map(entity=>({id:entity.id,name:entity.name,aliases:entity.aliases,kind:'entity' as const,icon:null}))];
  const knownKeys=new Set(knownItems.map(item=>item.kind+':'+item.id));
  const items=[...knownItems,...textSearch.results.filter(result=>!knownKeys.has(result.kind+':'+result.id)).map(result=>({id:result.id,name:result.name,kind:result.kind,icon:null,aliases:[] as string[]}))];
  const matches=combinedMatches(items,query,semantic.results,textSearch.results);
  const visible=term ? matches : matches.filter(item=>item.kind==='page').slice(0,6);
  const keyFor=(item:typeof matches[number])=>item.kind+'-'+item.id;
  const selectedIndex=Math.max(0,visible.findIndex(item=>keyFor(item)===selected)),active=visible[selectedIndex],activeId=active ? keyFor(active) : undefined;
  useEffect(()=>{if(activeId) buttons.current.get(activeId)?.scrollIntoView({block:'nearest'});},[activeId,selectedIndex]);
  const semanticNotes=new Map(semantic.results.map(result=>[result.id,result]));
  const previews=useSearchSnippets(vaultId,query,(term?matches:[]).filter(item=>item.kind==='page'&&!textNotes.get('page:'+item.id)?.snippet&&!semanticNotes.get(item.id)?.snippet).map(item=>item.id));
  const entityDescriptions=new Map(entities.map(entity=>[entity.id,entity.description]));
  function suppressSemantic() {semantic.cancel();setSemanticSuppressed(true);}
  function select(key:string) {suppressSemantic();setSelected(key);}
  function close() {suppressSemantic();onClose();}
  function open(item:typeof matches[number]) {suppressSemantic();const reference=textNotes.get(item.kind+':'+item.id)?.reference??semanticNotes.get(item.id)?.reference;if(item.kind==='entity'&&reference)onOpenPassage(reference,buttons.current.get(keyFor(item)));else if(item.kind==='page') onOpenPage(item.id); else onOpenEntity(item.id);}
  function keyDown(event:KeyboardEvent<HTMLDivElement>) {
    if(event.nativeEvent.isComposing) return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k') {event.preventDefault();event.stopPropagation();close();return;}
    if(event.target!==input.current) return;
    if((event.key==='ArrowDown'||event.key==='ArrowUp')&&visible.length) {
      event.preventDefault();
      const next=(selectedIndex+(event.key==='ArrowDown'?1:-1)+visible.length)%visible.length;
      select(keyFor(visible[next]!));
    }
    if(event.key==='Enter'&&active) {event.preventDefault();open(active);}
  }
  return <Modal className="vault-search-dialog" titleId="vault-search-title" onClose={close} dismissOnBackdrop>
    <div className="spotlight-search" onKeyDown={keyDown}>
      <h2 id="vault-search-title" className="sr-only">Search vault</h2>
      <div className="spotlight-search-input"><Icon name="search"/><input ref={input} autoFocus type="search" role="combobox" aria-label="Search notes and knowledge" aria-autocomplete="list" aria-expanded="true" aria-controls="vault-search-results" aria-activedescendant={activeId ? 'search-result-'+activeId : undefined} autoComplete="off" maxLength={2000} placeholder="Search names, page and source text, or ideas…" value={query} onChange={event=>{semantic.cancel();setQuery(event.target.value);setSelected(null);setSemanticSuppressed(false);}}/>{(textSearch.loading||semantic.loading)&&<span className="scan-spinner" aria-label={textSearch.loading?"Searching local text":"Finding related pages"}/>}<button className="spotlight-close" aria-label="Close search" title="Close search (Esc)" onClick={close}><Icon name="close"/></button></div>
      <div className="spotlight-search-body">
        <p className="spotlight-results-label" role="status">{!term?'Recently updated pages':`${matches.length} ${matches.length===1?'result':'results'}${textSearch.loading?' · Searching local text…':''}${semantic.loading?' · Finding related pages…':''}${textSearch.hasMore?' · More text matches available; narrow your search.':''}`}</p>
        {textSearch.error&&<p className="search-error" role="status">Local text search is unavailable. Name matches and any related pages remain available.</p>}{semantic.error&&<p className="search-error" role="status">Related results are unavailable. Local text matches remain available.</p>}{previews.error&&<p className="search-error" role="status">Some note previews are unavailable. You can still open the results.</p>}
        <ul id="vault-search-results" className="vault-search-results" role="listbox" aria-label="Search results">{visible.map(item=>{
          const key=keyFor(item),retrieved=textNotes.get(item.kind+':'+item.id),reference=retrieved?.reference??semanticNotes.get(item.id)?.reference;
          const direct=item.name.toLowerCase().includes(term),alias=item.kind==='entity'&&item.aliases?.some(value=>value.toLowerCase().includes(term));
          const matchLabel=direct?(item.kind==='page'?'Matched in title':'Matched in name'):alias?'Matched in alias':retrieved?`Matched in ${retrieved.matchedIn}`:'Related by meaning';
          const snippet=term ? retrieved?.snippet || semanticNotes.get(item.id)?.snippet || (item.kind==='page'?previews.snippets[item.id]??semanticNotes.get(item.id)?.snippet??'':alias?item.aliases?.find(value=>value.toLowerCase().includes(term))??'':makeSearchSnippet(entityDescriptions.get(item.id)??'',query)) : '';
          return <li key={key} role="presentation"><button ref={el=>{if(el) buttons.current.set(key,el);else buttons.current.delete(key);}} id={'search-result-'+key} role="option" aria-selected={key===activeId} tabIndex={-1} onPointerMove={()=>select(key)} onMouseDown={event=>event.preventDefault()} onClick={()=>open(item)}>{item.kind==='page'?<PageIcon icon={item.icon}/>:<Icon name="knowledge"/>}<span><strong><HighlightedText text={item.name} query={query}/></strong><small>{item.kind==='page'?'Page':'Knowledge entity'}{term&&` · ${matchLabel}`}{reference&&` · ${citationLocation(reference)} · Open passage`}</small>{snippet&&<span className="search-result-snippet"><HighlightedText text={snippet} query={query}/></span>}</span>{key===activeId&&<span className="spotlight-open-hint" aria-hidden="true">↵</span>}</button></li>;
        })}</ul>
        {!visible.length&&!textSearch.loading&&!semantic.loading&&<p className="spotlight-empty">{term?'No matches. Try another name or idea.':'Search your pages and knowledge by name or idea.'}</p>}
      </div>
      <footer className="spotlight-search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Open</span><span>Related pages appear after a pause · OpenAI</span></footer>
    </div>
  </Modal>;
}
