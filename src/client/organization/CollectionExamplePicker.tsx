import {useState} from 'react';
import type {PageSummary} from '../../shared/domain';
import type {ExampleCollectionDefinition} from '../../shared/example-collections';

export function CollectionExamplePicker({pages,examples,onChange}:{pages:PageSummary[];examples:ExampleCollectionDefinition;onChange:(examples:ExampleCollectionDefinition)=>void}) {
  const [query,setQuery]=useState('');
  const names=new Map(pages.map(page=>[page.id,page.title||'Untitled']));
  const visible=pages.filter(page=>(page.title||'Untitled').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0,50);
  function toggle(id:string,positive:boolean) {
    const field=positive?'positivePageIds':'negativePageIds';
    const selected=examples[field];
    onChange({...examples,[field]:selected.includes(id)?selected.filter(value=>value!==id):[...selected,id]});
  }
  return <section className="collection-example-picker"><h3>Example pages</h3><p>Choose two to five positive pages about the same topic, and optionally up to five negative pages to distinguish nearby topics. Matching reuses existing indexes and does not make provider calls.</p>
    <div className="example-selections">{(['positivePageIds','negativePageIds'] as const).map(field=><div key={field}><strong>{field==='positivePageIds'?'Positive examples':'Negative examples'} ({examples[field].length})</strong><ul>{examples[field].map(id=><li key={id}>{names.get(id)??'Unavailable page · '+id}<button type="button" aria-label={'Remove '+(field==='positivePageIds'?'positive':'negative')+' example: '+(names.get(id)??id)} onClick={()=>toggle(id,field==='positivePageIds')}>Remove</button></li>)}</ul></div>)}</div>
    <label>Find example pages<input type="search" aria-label="Find example pages" value={query} onChange={event=>setQuery(event.target.value)}/></label><p>Showing up to 50 pages. Filter by title to find more.</p><div className="example-page-options">{visible.map(page=>{const title=page.title||'Untitled',positive=examples.positivePageIds.includes(page.id),negative=examples.negativePageIds.includes(page.id);return <div className="example-page-option" key={page.id}><span>{title}</span><label><input type="checkbox" aria-label={'Positive example: '+title} checked={positive} disabled={negative||!positive&&examples.positivePageIds.length>=5} onChange={()=>toggle(page.id,true)}/>Positive</label><label><input type="checkbox" aria-label={'Negative example: '+title} checked={negative} disabled={positive||!negative&&examples.negativePageIds.length>=5} onChange={()=>toggle(page.id,false)}/>Negative</label></div>;})}</div>{!visible.length&&<p>No matching pages are available.</p>}
  </section>;
}
