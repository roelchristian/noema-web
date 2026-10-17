import type {Page} from '../../shared/domain';
import {classifiedConceptSubtypes} from '../../shared/concept-classification';
import {useEntitySchema} from '../knowledge/useEntitySchema';
export function PageConceptCategory({page}:{page:Page}) {
  const {schema}=useEntitySchema(page.vault_id);
  const classification=page.conceptClassification;
  const current=!!page.conceptContentHash&&classification?.contentHash===page.conceptContentHash;
  const names=classifiedConceptSubtypes(page).map(id=>schema.subtypes.find(subtype=>subtype.id===id&&subtype.type==='concept')?.name).filter(Boolean);
  return <section className="knowledge-concept-category" aria-label="Page concept category"><div className="knowledge-section-heading"><h2>Concept category</h2></div><p className="section-hint">{!current?'Classification pending in the background.':names.length?names.join(' · '):'No matching technical category.'}</p></section>;
}
