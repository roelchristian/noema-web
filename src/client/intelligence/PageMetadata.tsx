import {sourcePageChoices,sourcePageFormats} from '../../shared/source-page';
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
  const generated=page.aiStatus==='ai_generated'||page.aiStatus==='ai_generated_edited';
  const generation=page.generationMetadata;
  const sourceGeneration=generation?.type==='source_page'?generation:null;
  return <details className="knowledge-page-metadata" aria-labelledby="knowledge-page-metadata-heading">
    <summary className="knowledge-section-heading"><h2 id="knowledge-page-metadata-heading"><span>Properties</span><Icon name="chevron"/></h2></summary>
    <dl className="page-metadata-fields">
      {page.language&&<div><dt>Language</dt><dd title={page.language}>{languageLabel(page.language)}</dd></div>}
      {page.aiStatus&&page.aiStatus!=='regular'&&<div><dt>Origin</dt><dd>{pageAIStatusLabels[page.aiStatus]}</dd></div>}
      {created&&<div><dt>Created</dt><dd>{created}</dd></div>}
      {updated&&<div><dt>Updated</dt><dd>{updated}</dd></div>}
      {page.editLocked&&<div><dt>Editing</dt><dd><Icon name="lock"/>Locked</dd></div>}
    </dl>
    {generated&&<section className="page-generation-metadata" aria-labelledby="page-generation-heading">
      <h3 id="page-generation-heading">AI generation</h3>
      {generation?<dl className="page-metadata-fields">
        <div><dt>Type</dt><dd>{sourceGeneration?sourcePageFormats[sourceGeneration.options.format].label:'Passage explanation'}</dd></div>
        {sourceGeneration&&<div><dt>Length</dt><dd>{sourcePageChoices.detail.options[sourceGeneration.options.detail]}</dd></div>}
        <div><dt>Output language</dt><dd>{generation.options.language||'Match the source'}</dd></div>
        <div><dt>Reader familiarity</dt><dd>{sourcePageChoices.familiarity.options[generation.options.familiarity]}</dd></div>
        {sourceGeneration&&<>
          <div><dt>Source scope</dt><dd>{sourceGeneration.options.beyondSources?'Include AI background knowledge':'Supplied source only'}</dd></div>
          <div><dt>Custom prompt</dt><dd className="page-generation-text">{sourceGeneration.userPrompt||'None'}</dd></div>
          {!!sourceGeneration.revisionFeedback.length&&<div><dt>Revisions</dt><dd><ol>{sourceGeneration.revisionFeedback.map((feedback,index)=><li key={index} className="page-generation-text">{feedback||'Fresh revision'}</li>)}</ol></dd></div>}
        </>}
        {sourceGeneration&&<div><dt>Prompt</dt><dd><details className="page-generation-prompt"><summary>View prompt</summary><p>{sourceGeneration.formatPrompt}</p></details></dd></div>}
      </dl>:<p className="page-generation-unavailable">Not available</p>}
    </section>}
  </details>;
}
