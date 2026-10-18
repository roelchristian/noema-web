import type {Page} from '../../shared/domain';
import {pageAIStatusLabels} from '../../shared/page-ai-status';
import {Icon} from '../components/Icon';

function languageLabel(language:string):string {
  try{return new Intl.DisplayNames(['en'],{type:'language'}).of(language)??language;}
  catch{return language;}
}

export function PageMetadata({page}:{page:Page}) {
  const date=(value:string|null|undefined)=>{
    if(!value)return null;
    const parsed=new Date(value);
    return Number.isFinite(parsed.getTime())?<time dateTime={value} title={parsed.toLocaleString()}>{parsed.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}</time>:null;
  };
  const created=date(page.created_at),updated=date(page.updated_at);
  return <details className="knowledge-page-metadata" aria-labelledby="knowledge-page-metadata-heading">
    <summary className="knowledge-section-heading"><h2 id="knowledge-page-metadata-heading"><span>Properties</span><Icon name="chevron"/></h2></summary>
    <dl className="page-metadata-fields">
      {page.language&&<div><dt>Language</dt><dd title={page.language}>{languageLabel(page.language)}</dd></div>}
      {page.aiStatus&&page.aiStatus!=='regular'&&<div><dt>Origin</dt><dd>{pageAIStatusLabels[page.aiStatus]}</dd></div>}
      {created&&<div><dt>Created</dt><dd>{created}</dd></div>}
      {updated&&<div><dt>Updated</dt><dd>{updated}</dd></div>}
      {page.editLocked&&<div><dt>Editing</dt><dd><Icon name="lock"/>Locked</dd></div>}
    </dl>
  </details>;
}
