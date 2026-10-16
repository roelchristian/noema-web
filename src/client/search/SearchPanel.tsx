import {useEffect,useRef,useState} from 'react';
import type {Entity,PageSummary} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {PageIcon} from '../components/PageIcon';
import {combinedMatches} from './matches';
import {useSemanticSearch} from './useSemanticSearch';
import {HighlightedText} from './HighlightedText';
import {useSearchSnippets} from './useSearchSnippets';
import {makeSearchSnippet} from '../../shared/search-snippets';
export function SearchPanel({vaultId,pages,entities,onOpenPage,onOpenEntity,onClose}:{vaultId:string;pages:PageSummary[];entities:Entity[];onOpenPage:(id:string)=>void;onOpenEntity:(id:string)=>void;onClose:()=>void}) {
  const [query,setQuery]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const semantic=useSemanticSearch(vaultId,query),term=query.trim().toLowerCase();
  useEffect(()=>{input.current?.focus();},[]);
  const scores=new Map(semantic.results.map(result=>[result.id,result.score]));
  const matches=combinedMatches([...pages.map(page=>({id:page.id,name:page.title||'Untitled',kind:'page' as const,icon:page.icon})),...entities.map(entity=>({id:entity.id,name:entity.name,kind:'entity' as const,icon:null}))],query,semantic.results);
  const semanticNotes=new Map(semantic.results.map(result=>[result.id,result]));
  const previews=useSearchSnippets(vaultId,query,(term?matches:[]).filter(item=>item.kind==='page'&&!semanticNotes.get(item.id)?.snippet).map(item=>item.id));
  const entityDescriptions=new Map(entities.map(entity=>[entity.id,entity.description]));
  return <aside className="entity-panel vault-search-panel" aria-label="Search vault" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <div className="panel-top"><span><Icon name="search"/>Search vault</span><button aria-label="Close search panel" onClick={onClose}>×</button></div>
    <div className="panel-body"><label className="vault-search-input"><span className="sr-only">Search notes and knowledge</span><input ref={input} type="search" maxLength={2000} placeholder="Search names or ideas…" value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <p className="section-hint">Text matches and semantic note results in this vault. Semantic queries use OpenAI.</p>
      <div aria-live="polite"><p className="search-status">{!term?'Enter a name or idea to search.':semantic.loading?'Finding semantic matches…':`${matches.length} results`}</p>{semantic.error&&<p className="search-error">{semantic.error}</p>}{previews.error&&<p className="search-error">Some note previews are unavailable. You can still open the results.</p>}</div>
      <ul className="vault-search-results">{(term?matches:[]).map(item=>{const text=item.name.toLowerCase().includes(term),meaning=item.kind==='page'&&scores.has(item.id);const snippet=item.kind==='page'?previews.snippets[item.id]??semanticNotes.get(item.id)?.snippet??'':makeSearchSnippet(entityDescriptions.get(item.id)??'',query);return <li key={item.kind+item.id}><button onClick={()=>item.kind==='page'?onOpenPage(item.id):onOpenEntity(item.id)}>{item.kind==='page'?<PageIcon icon={item.icon}/>:<Icon name="knowledge"/>}<span><strong><HighlightedText text={item.name} query={query}/></strong><small>{item.kind==='page'?'Page':'Knowledge entity'} · {text&&meaning?'Text + semantic':text?'Text match':'Related by meaning'}</small>{snippet&&<span className="search-result-snippet"><HighlightedText text={snippet} query={query}/></span>}</span></button></li>;})}</ul>
      {term&&!matches.length&&!semantic.loading&&<p className="section-hint">No matches. Try another phrase, or index notes in Intelligence settings.</p>}
    </div>
  </aside>;
}
