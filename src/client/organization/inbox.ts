import type { Organization, PageSummary } from '../../shared/domain';

export function inboxPages(pages: PageSummary[], organization: Organization): PageSummary[] {
  const organized = new Set(organization.locations.filter(location => location.kind === 'page' && location.collection_id).map(location => location.item_id));
  return pages.filter(page => !organized.has(page.id));
}
