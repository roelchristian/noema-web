import {t as uiText} from '../i18n';
import {Icon} from '../components/Icon';
import {PageIcon} from '../components/PageIcon';
import {TitleText} from '../components/TitleText';
import type {EntityPageMention, EntityPageAssociation} from '../../shared/domain';
import type {EntityMentionReference} from '../../shared/entity-mentions';

export function EntityMentions({pages, linkedPages, onOpenPage, onOpenMention, onPin, pinning, error}: {
  pages: EntityPageMention[]; linkedPages: EntityPageAssociation[];
  onOpenPage: (id: string) => void; onOpenMention?: (reference: EntityMentionReference) => void;
  onPin: (id: string) => void; pinning: boolean; error: string;
}) {
  return <section className="eh-section"><h2>{uiText('Mentioned in pages')} <span>{pages.length}</span></h2>
    {pages.length ? <ul className="entity-connection-list entity-page-mentions">{pages.map(page => {
      const pinned = linkedPages.some(linked => linked.id === page.id && linked.pinned);
      return <li key={page.id}>
        <button type="button" className="eh-mention-page" onClick={() => onOpenPage(page.id)}><PageIcon icon={page.icon}/><span><span className="entity-mention-heading"><strong><TitleText text={page.title || 'Untitled'}/></strong><small className="entity-mention-count" aria-label={`${page.mentionCount} ${page.mentionCount === 1 ? 'mention' : 'mentions'}`}>{page.mentionCount}×</small></span>{!page.contexts?.length && page.excerpt && <small className="entity-mention-excerpt">{page.excerpt}</small>}</span><Icon name="chevron"/></button>
        {!!page.contexts?.length && <ul className="eh-mention-contexts" aria-label={uiText('Mention contexts')}>{page.contexts.map(context => <li key={context.occurrences[0]?.id ?? context.blockId}>
          {!!context.heading.length && <p className="eh-context-heading">{context.heading.join(' › ')}</p>}
          <p className="eh-context-excerpt">{context.excerpt}</p>
          <div className="eh-occurrences">{context.occurrences.map((occurrence, index) => <button type="button" key={occurrence.id} onClick={() => onOpenMention ? onOpenMention(occurrence.reference) : onOpenPage(page.id)} aria-label={`${uiText('Go to mention')} ${index + 1}: ${occurrence.label}`}><span aria-hidden="true">{index + 1}. </span>{occurrence.label}<span aria-hidden="true"> ↗</span></button>)}</div>
        </li>)}</ul>}
        <button type="button" className="eh-mention-pin" disabled={pinning || pinned} onClick={() => onPin(page.id)}>{uiText(pinned ? 'Pinned' : 'Pin page')}</button>
      </li>;
    })}</ul> : <p className="entity-detail-empty">{uiText('No pages mention this entity yet. Tag it in a page to see it here.')}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
