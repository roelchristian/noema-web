import {noteCitations} from '../../shared/citations';
import type {Entity,Page} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {Select} from '../components/Select';

interface Props {
  page:Page;entities:Entity[];onOpenEntity:(id:string)=>void;
  onSourcesChange:(ids:string[])=>void;onCreateSource:()=>void;
}

export function PageSources({page,entities,onOpenEntity,onSourcesChange,onCreateSource}:Props) {
  const citations=new Map<string,{count:number;numbers:number[]}>();
  for(const entry of noteCitations(page.blocks).values()){
    const id=entry.reference.sourceId,current=citations.get(id)??{count:0,numbers:[]};
    current.count+=entry.occurrences.length;current.numbers.push(entry.number);citations.set(id,current);
  }
  const byId=new Map(entities.map(entity=>[entity.id,entity]));
  const sourceIds=[...new Set(page.sourceIds)];
  const available=entities.filter(entity=>entity.vault_id===page.vault_id&&entity.type==='source'&&!entity.inactive&&!sourceIds.includes(entity.id)).sort((left,right)=>left.name.localeCompare(right.name));
  return <section className="knowledge-sources page-sources" aria-labelledby="knowledge-sources-heading">
    <div className="knowledge-section-heading">
      <h2 id="knowledge-sources-heading"><Icon name="source"/>Sources<span className="knowledge-count">{sourceIds.length}</span></h2>
      <button type="button" className="page-sources-new" disabled={!!page.editLocked} aria-label="Create a new source" onClick={onCreateSource}><Icon name="plus"/>New</button>
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
    {!page.editLocked&&<div className="page-sources-attach">
      <Icon name="plus"/>
      <Select disabled={!available.length} aria-label="Attach an existing source to this page" value="" onChange={event=>{if(event.target.value)onSourcesChange([...sourceIds,event.target.value]);}}>
        <option value="">{available.length?'Attach existing source…':'No more sources to attach'}</option>
        {available.map(entity=><option value={entity.id} key={entity.id}>{entity.name}</option>)}
      </Select>
    </div>}
  </section>;
}
