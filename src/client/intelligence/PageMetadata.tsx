import {personaIdentityName} from '../../shared/ai-personas';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {sourcePageChoices,sourcePageFormats} from '../../shared/source-page';
import type {Page} from '../../shared/domain';
import {pageAIProvenance} from '../../shared/page-ai-status';
import {PageProvenanceFields} from '../components/PageProvenance';
import {Icon} from '../components/Icon';

function languageLabel(language:string):string {
  try{return new Intl.DisplayNames(['en'],{type:'language'}).of(language)??language;}
  catch{return language;}
}

export function PageMetadata({page}:{page:Page}) {
  const date=(value:string|null|undefined)=>{
    if(!value)return null;
    const parsed=new Date(value);
    return Number.isFinite(parsed.getTime())?<time dateTime={value} title={parsed.toLocaleString(getLocale())}>{parsed.toLocaleDateString(getLocale(),{year:'numeric',month:'short',day:'numeric'})}</time>:null;
  };
  const created=date(page.created_at),updated=date(page.updated_at);
  const provenance=pageAIProvenance(page);
  const generated=provenance.origin==='ai_generated';
  const generation=page.generationMetadata;
  const sourceGeneration=generation?.type==='source_page'?generation:null;
  return <details className="knowledge-page-metadata" aria-labelledby="knowledge-page-metadata-heading">
    <summary className="knowledge-section-heading"><h2 id="knowledge-page-metadata-heading"><span>{uiText("Properties")}</span><Icon name="chevron"/></h2></summary>
    <dl className="page-metadata-fields">
      {page.language&&<div><dt>{uiText("Language")}</dt><dd title={page.language}>{languageLabel(page.language)}</dd></div>}
      {created&&<div><dt>{uiText("Created")}</dt><dd>{created}</dd></div>}
      {updated&&<div><dt>{uiText("Updated")}</dt><dd>{updated}</dd></div>}
      {page.editLocked&&<div><dt>{uiText("Editing")}</dt><dd><Icon name="lock"/>{uiText("Locked")}</dd></div>}
    </dl>
    <section className="page-generation-metadata" aria-label={uiText("Creation & AI history")}>
      <h3>{uiText("Creation & AI history")}</h3>
      <PageProvenanceFields provenance={provenance}/>
    </section>
    {generated&&<section className="page-generation-metadata" aria-labelledby="page-generation-heading">
      <h3 id="page-generation-heading">{uiText("Generation details")}</h3>
      {generation?<dl className="page-metadata-fields">
        <div><dt>{uiText("Type")}</dt><dd>{sourceGeneration?uiText(sourcePageFormats[sourceGeneration.options.format].label):uiText("Passage explanation")}</dd></div>
        {generation.persona&&<div><dt>AI Persona</dt><dd>{personaIdentityName(generation.persona)} · v{generation.persona.version}</dd></div>}
        {sourceGeneration&&<div><dt>{uiText("Length")}</dt><dd>{uiText(sourcePageChoices.detail.options[sourceGeneration.options.detail])}</dd></div>}
        <div><dt>{uiText("Output language")}</dt><dd>{generation.options.language||uiText("Match the source")}</dd></div>
        <div><dt>{uiText("Reader familiarity")}</dt><dd>{uiText(sourcePageChoices.familiarity.options[generation.options.familiarity])}</dd></div>
        {sourceGeneration&&<>
          <div><dt>{uiText("Source scope")}</dt><dd>{sourceGeneration.options.beyondSources?uiText("Include AI background knowledge"):uiText("Supplied source only")}</dd></div>
          <div><dt>{uiText("Custom prompt")}</dt><dd className="page-generation-text">{sourceGeneration.userPrompt||uiText("None")}</dd></div>
          {!!sourceGeneration.revisionFeedback.length&&<div><dt>{uiText("Revisions")}</dt><dd><ol>{sourceGeneration.revisionFeedback.map((feedback,index)=><li key={index} className="page-generation-text">{feedback||uiText("Fresh revision")}</li>)}</ol></dd></div>}
        </>}
        {sourceGeneration&&<div><dt>{uiText("Prompt")}</dt><dd><details className="page-generation-prompt"><DisclosureSummary>{uiText("View prompt")}</DisclosureSummary><p>{sourceGeneration.formatPrompt}</p></details></dd></div>}
      </dl>:<p className="page-generation-unavailable">{uiText("Not available")}</p>}
    </section>}
  </details>;
}
