import {useEffect,useId,useState} from 'react';
import type {Entity} from '../../shared/domain';
import type {EntityNeighborhood as Neighborhood} from '../../shared/entity-neighborhood';
import {api} from '../api';

export function EntityNeighborhood({vaultId,id,refreshKey,onOpen,onInspect}: {
 vaultId:string;id:string;entities?:Entity[];refreshKey:string;onOpen:(id:string)=>void;onInspect?:(id:string)=>void;
}) {
 const [depth,setDepth]=useState<1|2>(1),[relationType,setRelationType]=useState(''),[view,setView]=useState<'graph'|'list'>('graph');
 const [data,setData]=useState<Neighborhood|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const marker=useId().replaceAll(':','');
 useEffect(()=>{setDepth(1);setRelationType('');},[vaultId,id]);
 useEffect(()=>{
  const controller=new AbortController();let active=true;setData(null);setError('');
  void api.entityNeighborhood(vaultId,id,depth,relationType||undefined,controller.signal).then(value=>{if(active)setData(value);}).catch(value=>{if(active&&!controller.signal.aborted)setError(String(value));});
  return()=>{active=false;controller.abort();};
 },[vaultId,id,refreshKey,depth,relationType,attempt]);
 const entities=new Map(data?.nodes.map(entity=>[entity.id,entity])??[]);
 const name=(id:string)=>entities.get(id)?.name??id;
 const status=(entity:Entity)=>entity.archived_at?' · Archived':entity.inactive?' · Inactive':'';
 const first=new Set(data?.edges.filter(edge=>edge.sourceId===id||edge.targetId===id).flatMap(edge=>[edge.sourceId,edge.targetId]).filter(target=>target!==id)??[]);
 const one=data?.nodes.filter(node=>first.has(node.id))??[],two=data?.nodes.filter(node=>node.id!==id&&!first.has(node.id))??[];
 const height=Math.max(280,Math.max(one.length,two.length)*82+80);
 const positions=new Map<string,{x:number;y:number}>([[id,{x:130,y:height/2}]]);
 for(const [nodes,x] of [[one,450],[two,770]] as const)nodes.forEach((node,index)=>positions.set(node.id,{x,y:50+index*82}));
 return <section className="entity-neighborhood" aria-label="Entity neighborhood">
  <div className="en-controls"><label>Distance<select value={depth} onChange={event=>setDepth(Number(event.target.value) as 1|2)}><option value="1">One hop</option><option value="2">Two hops</option></select></label>
   <label>Relationship label<select value={relationType} onChange={event=>setRelationType(event.target.value)}><option value="">All relationship labels</option>{[...new Set([...(data?.relationTypes??[]),...(relationType?[relationType]:[])])].map(label=><option key={label} value={label}>{label}</option>)}</select></label>
   <div role="group" aria-label="Neighborhood view"><button type="button" aria-pressed={view==='graph'} onClick={()=>setView('graph')}>Graph</button><button type="button" aria-pressed={view==='list'} onClick={()=>setView('list')}>List</button></div>
  </div>
  <p className="eh-writing-hint">Arrows follow the saved direction. Dashed arrows are property references, which remain visible with every relationship label. Activate an entity to open its homepage.</p>
  {error&&<div role="alert">{error} <button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry</button></div>}
  {!data&&!error&&<p role="status">Loading neighborhood…</p>}
  {data&&<>
   <p className="en-count">{data.nodes.length} entities · {data.edges.length} connections</p>
   {data.truncated&&<p className="en-limit" role="status">This neighborhood is limited to 40 entities and 100 connections. Some connections are omitted. Use one hop or choose a relationship label to narrow the view.</p>}
   {!data.edges.length?<p>No connections found for this neighborhood.</p>:view==='graph'?<div className="en-canvas"><svg viewBox={`0 0 1040 ${height}`} width="1040" height={height} role="group" aria-roledescription="directed graph" aria-label={`Directed neighborhood of ${name(id)}. ${data.edges.length} connections. A text list is available with the List button.`}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>
    {data.edges.map((edge,index)=>{
     const source=positions.get(edge.sourceId)!,target=positions.get(edge.targetId)!;
     const same=source.x===target.x,loop=edge.sourceId===edge.targetId;
     const bend=26+(index%5)*12;
     const path=loop?`M ${source.x+72} ${source.y-14} C ${source.x+150} ${source.y-95},${source.x+150} ${source.y+95},${source.x+72} ${source.y+14}`:same?`M ${source.x+72} ${source.y} Q ${source.x+150+bend} ${(source.y+target.y)/2} ${target.x+72} ${target.y}`:`M ${source.x+(source.x<target.x?88:-88)} ${source.y} Q ${(source.x+target.x)/2} ${(source.y+target.y)/2-bend} ${target.x+(source.x<target.x?-88:88)} ${target.y}`;
     const labelX=loop?source.x+140:same?source.x+110+bend/2:(source.x+target.x)/2;
     const labelY=loop?source.y:same?(source.y+target.y)/2:(source.y+target.y)/2-bend/2;
     return <g key={edge.id} className={`en-edge en-edge-${edge.kind}`}><title>{name(edge.sourceId)} → {name(edge.targetId)}: {edge.label} ({edge.kind==='property'?'property reference':'relationship'})</title><path d={path} markerEnd={`url(#${marker})`}/><text x={labelX} y={labelY-3} textAnchor="middle">{edge.label.length>27?edge.label.slice(0,26)+'…':edge.label}</text></g>;
    })}
    {data.nodes.map(entity=>{
     const position=positions.get(entity.id)!;
     return <g key={entity.id} transform={`translate(${position.x},${position.y})`} className={`en-node${entity.id===id?' en-root':''}`} role="button" tabIndex={0} aria-label={`Open ${entity.name}${status(entity)}`} onClick={()=>onOpen(entity.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen(entity.id);}}}>
      <title>{entity.name} · {entity.type}{status(entity)}</title><rect x="-88" y="-26" width="176" height="52" rx="8"/><text textAnchor="middle" y="-3">{entity.name.length>23?entity.name.slice(0,22)+'…':entity.name}</text><text className="en-node-type" textAnchor="middle" y="15">{entity.type}{status(entity)}</text>
     </g>;
    })}
   </svg></div>:<ul className="en-edge-list">{data.edges.map(edge=><li key={edge.id}><span className={`en-kind en-kind-${edge.kind}`}>{edge.kind==='property'?'Property reference':'Relationship'}</span><div><button type="button" onClick={()=>onOpen(edge.sourceId)}>{name(edge.sourceId)}{entities.get(edge.sourceId)&&status(entities.get(edge.sourceId)!)}</button><span className="en-direction"> → {edge.label} → </span><button type="button" onClick={()=>onOpen(edge.targetId)}>{name(edge.targetId)}{entities.get(edge.targetId)&&status(entities.get(edge.targetId)!)}</button></div></li>)}</ul>}
   {onInspect&&data.nodes.length>1&&<details className="en-inspect"><summary>Inspect an entity in context</summary><ul>{data.nodes.filter(entity=>entity.id!==id).map(entity=><li key={entity.id}><button type="button" onClick={()=>onInspect(entity.id)}>Inspect {entity.name}{status(entity)}</button></li>)}</ul></details>}
  </>}
 </section>;
}
