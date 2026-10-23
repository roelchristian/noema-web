import type {Page} from '../../shared/domain';
import {pageAIProvenance, pageCreationLabels} from '../../shared/page-ai-status';
import {t as uiText} from '../i18n';
import {Icon} from './Icon';

type Provenance = ReturnType<typeof pageAIProvenance>;
export function PageProvenanceFields({provenance}: {provenance: Provenance}) {
  return <dl className="page-metadata-fields">
    <div><dt>{uiText('Creation method')}</dt><dd>{uiText(pageCreationLabels[provenance.origin])}</dd></div>
    <div><dt>{uiText('AI contributions')}</dt><dd>{provenance.contributions.length ? provenance.contributions.map(label => <p key={label}>{uiText(label)}</p>) : uiText('No recorded AI writing contributions')}</dd></div>
    {provenance.origin === 'ai_generated' && <div><dt>{uiText('Editing history')}</dt><dd>{uiText(provenance.editedAfterGeneration ? 'Edited after generation' : 'Unedited since generation')}</dd></div>}
  </dl>;
}

export function PageProvenanceDisclosure({page}: {page: Page}) {
  const provenance = pageAIProvenance(page);
  if (!provenance.assisted) return null;
  return <details className="page-ai-provenance">
    <summary aria-label={uiText('Creation & AI history') + ': ' + uiText(provenance.label)}><Icon name="sparkles"/><span>{uiText(provenance.label)}</span></summary>
    <div className="page-provenance-details">
      <strong>{uiText('Creation & AI history')}</strong>
      <PageProvenanceFields provenance={provenance}/>
    </div>
  </details>;
}
