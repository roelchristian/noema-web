import {noteCitations} from '../../shared/citations';
import type {Entity,Page} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {ActionMenu} from '../components/ActionMenu';
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
    setLoading(true);
    const controller=new AbortController();
    const load=()=>{if(document.hidden)return;void api.suggestedSources(page.vault_id,page.id,controller.signal).then(items=>{if(!controller.signal.aborted){setSuggestions(items);setError('');}}).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Could not load source suggestions.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});};
    const timeout=setTimeout(load,400),interval=setInterval(load,15000);
    return()=>{controller.abort();clearTimeout(timeout);clearInterval(interval);};
  },[page.vault_id,page.id,page.revision]);
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
  const ranks=new Map(suggested.map((item,index)=>[item.sourceId,index]));
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const searchResults=normalizedQuery?available.filter(entity=>entity.name.toLocaleLowerCase().includes(normalizedQuery)).sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity)||a.name.localeCompare(b.name)).slice(0,8):[];
  const attach=(id:string)=>{onSourcesChange([...sourceIds,id]);setPicker(false);setQuery('');};
  return <section className="knowledge-sources page-sources" aria-labelledby="knowledge-sources-heading">
    <div className="knowledge-section-heading">
      <h2 id="knowledge-sources-heading"><Icon name="source"/>Sources<span className="knowledge-count">{sourceIds.length}</span></h2>
      {!page.editLocked&&<span className="page-sources-actions"><ActionMenu label="Add source" icon="plus" actions={[
        {label:'Attach existing source…',icon:'source',onSelect:()=>setPicker(true)},
        {label:'New source…',icon:'compose',onSelect:()=>{setPicker(false);setQuery('');onCreateSource();}},
      ]}/></span>}
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
    {!page.editLocked&&picker&&<div className="page-source-picker" id="page-source-picker" onKeyDown={event=>{if(event.key==='Escape'){setPicker(false);setQuery('');event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.page-sources-actions>button')?.focus();}}}>
      <div className="page-source-search"><input autoFocus type="search" aria-label="Search sources to attach" placeholder="Search sources…" value={query} onChange={event=>setQuery(event.target.value)}/><button type="button" className="page-sources-detach" aria-label="Close source search" onClick={()=>{setPicker(false);setQuery('');}}><Icon name="close"/></button></div>
      {searchResults.length>0&&<ul className="page-sources-list" aria-label="Matching sources">{searchResults.map(entity=><li key={entity.id} className="page-sources-row"><button type="button" className="page-sources-open" onClick={()=>attach(entity.id)}><span className="page-sources-copy"><span className="page-sources-name">{entity.name}</span>{ranks.has(entity.id)&&<span className="page-source-status"><Icon name="lightbulb"/>Suggested</span>}</span></button><button type="button" className="page-sources-detach" aria-label={`Attach ${entity.name}`} onClick={()=>attach(entity.id)}><Icon name="plus"/></button></li>)}</ul>}
      {normalizedQuery&&!searchResults.length&&<p className="page-source-label" role="status">No matching sources.</p>}
      {!normalizedQuery&&<p className="page-source-label">Search by name to attach an existing source.</p>}
    </div>}
    {suggested.length>0&&<div className="page-source-suggestions">
      <p className="page-source-label">Suggested</p>
      <ul className="page-sources-list" aria-label="Suggested sources">
        {suggested.map(item=>{const name=byId.get(item.sourceId)!.name;return <li key={item.sourceId} className="page-sources-row is-suggested">
          <button type="button" className="page-sources-open" onClick={()=>onOpenEntity(item.sourceId)} title={`${name}\n${item.excerpt}`} aria-label={`Preview suggested source: ${name}`}>
            <span className="page-sources-file" aria-hidden="true"><Icon name="lightbulb"/></span>
            <span className="page-sources-copy"><span className="page-sources-name">{name}</span><span className="page-source-excerpt">{item.excerpt}</span></span>
          </button>
          {!page.editLocked&&<><button type="button" className="page-sources-detach page-source-accept" aria-label={`Attach ${name}`} title="Attach source" onClick={()=>attach(item.sourceId)}><Icon name="plus"/></button>
          <button type="button" className="page-sources-detach" disabled={dismissing!==null} aria-label={`Dismiss suggestion: ${name}`} title="Dismiss suggestion" onClick={()=>void dismiss(item.sourceId)}><Icon name="close"/></button></>}
        </li>;})}
      </ul>
    </div>}
    {loading&&!suggested.length&&<p className="page-source-label" role="status">Finding suggested sources…</p>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </section>;
}
