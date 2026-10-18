import type {Page} from '../../shared/domain';
import {pageAIStatusLabels,pageAIStatusDescriptions} from '../../shared/page-ai-status';
import {pageIcons} from '../../shared/page-icons';
import {Icon} from '../components/Icon';

function languageLabel(language:string):string {
  try{return new Intl.DisplayNames(['en'],{type:'language'}).of(language)??language;}
  catch{return language;}
}

export function PageMetadata({page}:{page:Page}) {
  const aiStatus=page.aiStatus??'regular';
  const created=page.created_at?new Date(page.created_at):null,validCreatedDate=created!==null&&Number.isFinite(created.getTime());
  const updated=new Date(page.updated_at),validDate=Number.isFinite(updated.getTime());
  const icon=pageIcons.find(icon=>icon.id===page.icon);
  return <details className="knowledge-page-metadata" aria-labelledby="knowledge-page-metadata-heading">
    <summary className="knowledge-section-heading"><h2 id="knowledge-page-metadata-heading"><span>Properties</span><Icon name="chevron"/></h2></summary>
    <dl className="page-metadata-fields">
      <div><dt>Title</dt><dd className="page-metadata-title" title={page.title}>{page.title||'Untitled'}</dd></div>
      <div><dt>Language</dt><dd>{page.language?<><span>{languageLabel(page.language)}</span><small>{page.language}</small></>:'Not recorded'}</dd></div>
      <div><dt>AI status</dt><dd title={pageAIStatusDescriptions[aiStatus]}>{pageAIStatusLabels[aiStatus]}</dd></div>
      <div><dt>Created</dt><dd>{validCreatedDate?<time dateTime={page.created_at!} title={created.toLocaleString()}>{created.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}<small>{created.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</small></time>:'Not available'}</dd></div>
      <div><dt>Updated</dt><dd>{validDate?<time dateTime={page.updated_at} title={updated.toLocaleString()}>{updated.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}<small>{updated.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</small></time>:'Not available'}</dd></div>
      <div><dt>Revision</dt><dd>{page.revision}</dd></div>
      <div><dt>Editing</dt><dd>{page.editLocked?'Locked':page.editProtected?'Unlocked · password protected':'Editable'}</dd></div>
      <div><dt>Icon</dt><dd>{icon?.label??'Default'}</dd></div>
      <div><dt>Cover image</dt><dd>{page.featuredImageId?'Attached':'None'}</dd></div>
      <div><dt>Page ID</dt><dd><code>{page.id}</code></dd></div>
    </dl>
  </details>;
}
