import {noteCitations} from '../../shared/citations';
import type {Entity,Page} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {useEffect,useState} from 'react';
import {api} from '../api';
import type {SuggestedSource} from '../../shared/embeddings';

interface Props {
  page:Page;entities:Entity[];onOpenEntity:(id:string)=>void;
  onSourcesChange:(ids:string[])=>void;onCreateSource:()=>void;
}

export function PageSources({page,entities,onOpenEntity,onSourcesChange,onCreateSource}:Props) {
  const [suggestions,setSuggestions]=useState<SuggestedSource[]>([]);
  const [picker,setPicker]=useState(false),[query,setQuery]=useState(''),[error,setError]=useState('');
  const [dismissing,setDismissing]=useState<string|null>(null);
  const [dismissed,setDismissed]=useState<Set<string>>(()=>new Set());
  const [loading,setLoading]=useState(false);
  useEffect(()=>{
    if(!picker)return;
    setLoading(true);
    const controller=new AbortController();
    const load=()=>{if(document.hidden)return;void api.suggestedSources(page.vault_id,page.id,controller.signal).then(items=>{if(!controller.signal.aborted){setSuggestions(items);setError('');}}).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Could not load source suggestions.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});};
    const timeout=setTimeout(load,400),interval=setInterval(load,15000);
    return()=>{controller.abort();clearTimeout(timeout);clearInterval(interval);};
  },[page.vault_id,page.id,page.revision,picker]);
  async function dismiss(id:string) {
    setDismissing(id);setError('');
    try {await api.dismissSource(page.vault_id,page.id,id);setDismissed(ids=>new Set([...ids,id]));setSuggestions(items=>items.filter(item=>item.sourceId!==id));}
    catch(reason){setError(reason instanceof Error?reason.message:'Could not dismiss source.');}
    finally {setDismissing(null);}
  }
  const citations=new Map<string,{count:number;numbers:number[]}>();
  for(const entry of noteCitations(page.blocks).values()){
    const id=entry.reference.sourceId,current=citations.get(id)??{count:0,numbers:[]};
    current.count+=entry.occurrences.length;current.numbers.push(entry.number);citations.set(id,current);
  }
  const byId=new Map(entities.map(entity=>[entity.id,entity]));
  const sourceIds=[...new Set(page.sourceIds)];
  const available=entities.filter(entity=>entity.vault_id===page.vault_id&&entity.type==='source'&&!entity.inactive&&!sourceIds.includes(entity.id)).sort((left,right)=>left.name.localeCompare(right.name));
  const suggested=suggestions.filter(item=>!dismissed.has(item.sourceId)&&available.some(entity=>entity.id===item.sourceId));
  const rankedIds=new Set(suggested.map(item=>item.sourceId));
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const searchResults=normalizedQuery?available.filter(entity=>!rankedIds.has(entity.id)&&entity.name.toLocaleLowerCase().includes(normalizedQuery)).slice(0,8):[];
  const matchingSuggestions=suggested.filter(item=>!normalizedQuery||byId.get(item.sourceId)?.name.toLocaleLowerCase().includes(normalizedQuery));
  const attach=(id:string)=>{onSourcesChange([...sourceIds,id]);setPicker(false);setQuery('');};
  return <section className="knowledge-sources page-sources" aria-labelledby="knowledge-sources-heading">
    <div className="knowledge-section-heading">
      <h2 id="knowledge-sources-heading"><Icon name="source"/>Sources<span className="knowledge-count">{sourceIds.length}</span></h2>
      {!page.editLocked&&<button type="button" className="page-sources-add" title="Attach source" aria-label="Attach source" aria-expanded={picker} aria-controls="page-source-picker" onClick={()=>setPicker(value=>!value)}><Icon name="plus"/></button>}
      <button type="button" className="page-sources-new" disabled={!!page.editLocked} aria-label="Create a new source" onClick={onCreateSource}>New</button>
    </div>
    {sourceIds.length>0?<ul className="page-sources-list" aria-label="Page sources">
      {sourceIds.map(id=>{
        const source=byId.get(id),name=source?.name??'Unavailable source',cited=citations.get(id);
        const references=cited?.numbers.map(number=>`[${number}]`).join(' ');
        return <li className="page-sources-row" key={id}>
          <button type="button" className="page-sources-open" onClick={()=>onOpenEntity(id)} aria-label={`Open source: ${name}`} title={name}>
            <span className="page-sources-file" aria-hidden="true"><Icon name="source"/></span>
            <span className="page-sources-copy"><span className="page-sources-name">{name}</span><span className="page-sources-meta">{cited?<><span>{cited.count} {cited.count===1?'citation':'citations'}</span><span className="page-sources-reference-numbers" title={references}>{cited.numbers.slice(0,3).map(number=>`[${number}]`).join(' ')}{cited.numbers.length>3?` +${cited.numbers.length-3}`:''}</span></>:'Attached to this page'}</span></span>
            <Icon name="chevron"/>
          </button>
          {!cited&&!page.editLocked&&<button type="button" className="page-sources-detach" title="Detach source" aria-label={`Detach ${name} from this page`} onClick={()=>onSourcesChange(sourceIds.filter(source=>source!==id))}><Icon name="close"/></button>}
        </li>;
      })}
    </ul>:<div className="page-sources-empty"><span className="page-sources-file" aria-hidden="true"><Icon name="source"/></span><p>Keep your sources close.<span>Attach a source or use /cite in your note.</span></p></div>}
    {!page.editLocked&&picker&&<div className="page-source-picker" id="page-source-picker" onKeyDown={event=>{if(event.key==='Escape'){setPicker(false);setQuery('');event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.page-sources-add')?.focus();}}}>
      <input autoFocus type="search" aria-label="Search sources to attach" placeholder="Search sources…" value={query} onChange={event=>setQuery(event.target.value)}/>
      {matchingSuggestions.length>0&&<><p className="page-source-label">Suggested for this page</p><ul className="page-sources-list" aria-label="Suggested sources">
        {matchingSuggestions.map(item=>{const name=byId.get(item.sourceId)!.name;return <li key={item.sourceId} className="page-sources-row">
          <button type="button" className="page-sources-open" onClick={()=>onOpenEntity(item.sourceId)} title={item.excerpt}><span className="page-sources-copy"><span className="page-sources-name">{name}</span><span className="page-source-excerpt">{item.excerpt}</span></span></button>
          <button type="button" className="page-sources-detach" aria-label={`Attach ${name}`} title="Attach source" onClick={()=>attach(item.sourceId)}><Icon name="plus"/></button>
          <button type="button" className="page-sources-detach" disabled={dismissing!==null} aria-label={`Dismiss suggestion: ${name}`} title="Dismiss suggestion" onClick={()=>void dismiss(item.sourceId)}><Icon name="close"/></button>
        </li>;})}
      </ul></>}
      {searchResults.length>0&&<><p className="page-source-label">Other sources</p><ul className="page-sources-list" aria-label="Matching sources">{searchResults.map(entity=><li key={entity.id} className="page-sources-row"><button type="button" className="page-sources-open" onClick={()=>attach(entity.id)}><span className="page-sources-name">{entity.name}</span></button><button type="button" className="page-sources-detach" aria-label={`Attach ${entity.name}`} onClick={()=>attach(entity.id)}><Icon name="plus"/></button></li>)}</ul></>}
      {normalizedQuery&&!matchingSuggestions.length&&!searchResults.length&&<p className="page-source-label" role="status">No matching sources.</p>}
      {loading&&!matchingSuggestions.length&&<p className="page-source-label" role="status">Finding suggested sources…</p>}
      {!loading&&!normalizedQuery&&!matchingSuggestions.length&&<p className="page-source-label">No suggestions yet. Search to attach a source.</p>}
    </div>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </section>;
}
