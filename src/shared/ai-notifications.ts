export type NotificationAction = 'entity_discovery' | 'page_enrichment' | 'source_enrichment' | 'block_explanation' | 'page_title' | 'page_summary' | 'entity_scan' | 'note_embedding' | 'source_import' | 'create_page_from_source';
export interface AINotification {
  id: string; action: NotificationAction; status: 'completed' | 'failed' | 'interrupted';
  vaultId: string; vaultName: string; pageId: string; entityId?: string | null; pageTitle: string | null; available: boolean;
  createdAt: string; readAt: string | null;
}
export interface AIRunningActivity { id: string; action: NotificationAction; vaultId: string; pageId: string; entityId?: string | null; pageTitle: string | null; available: boolean; startedAt: string }
export interface AINotificationQueue { items: AINotification[]; running: AIRunningActivity[]; unreadCount: number; through: number }
export function notificationMessage(item: Pick<AINotification,'action'|'status'|'pageTitle'|'entityId'>,translate:(message:string)=>string=message=>message): string {
  const phrase=(message:string,values:Record<string,string>)=>translate(message).replace(/\{(\w+)\}/g,(match,key)=>values[key]??match);
  const title=item.pageTitle || translate(item.action==='source_import'?'an unavailable source':'an unavailable page');
  if(item.action==='entity_discovery')return item.status==='completed'?phrase('Entity discovery ready to review: {title}',{title}):phrase('Entity discovery {status}: {title}',{status:translate(item.status),title});
  if(item.action==='create_page_from_source')return item.status==='completed'?(item.entityId?phrase('Page draft ready to review: {title}',{title}):phrase('Created page from source: {title}',{title})):phrase('Page creation {status} for {title}',{status:translate(item.status==='interrupted'?'interrupted':'failed'),title});
  if(item.action==='source_enrichment')return item.status==='completed'?phrase('Source enriched: {title}',{title}):phrase('Source AI enrichment {status}: {title}',{status:translate(item.status),title});
  if(item.action==='source_import')return item.status==='completed'?phrase('Source ready: {title}',{title}):phrase('Source processing {status}: {title} · Inactive',{status:translate(item.status==='interrupted'?'interrupted':'failed'),title});
  if(item.action==='page_enrichment')return item.status==='completed'?phrase('Page enriched: {title}',{title}):phrase('Page enrichment {status} for {title}',{status:translate(item.status),title});
  const action={block_explanation:'AI explanation',page_title:'Title generation',page_summary:'Summary generation',entity_scan:'Entity scan',note_embedding:'Search indexing'}[item.action];
  if(item.status==='failed') return phrase('{action} failed for {title}',{action:translate(action),title});
  if(item.status==='interrupted') return phrase('{action} interrupted for {title}',{action:translate(action),title});
  return translate({block_explanation:'Generated AI explanation for ',page_title:'Added title to ',page_summary:'Added summary to ',entity_scan:'Scanned entities in ',note_embedding:'Updated search index for '}[item.action])+title;
}
export function runningMessage(item: Pick<AIRunningActivity,'action'|'pageTitle'>,translate:(message:string)=>string=message=>message): string {
  if(item.action==='entity_discovery')return translate('Discovering entity connections: ')+(item.pageTitle||translate('Untitled'));
  if(item.action==='create_page_from_source')return translate('Creating page from source: ')+(item.pageTitle||translate('Untitled'));
  if(item.action==='source_enrichment')return translate('Enriching source with AI: ')+(item.pageTitle||translate('Untitled'));
  if(item.action==='source_import')return translate('Processing source: ')+(item.pageTitle||translate('Untitled'));
  if(item.action==='page_enrichment')return translate('Enriching page: ')+(item.pageTitle||translate('Untitled'));
  return translate({block_explanation:'Explaining blocks in ',page_title:'Adding title to ',page_summary:'Summarizing ',entity_scan:'Scanning entities in ',note_embedding:'Indexing '}[item.action])+(item.pageTitle || translate('Untitled'));
}
