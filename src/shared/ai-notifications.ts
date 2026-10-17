export type NotificationAction = 'block_explanation' | 'page_title' | 'page_summary' | 'entity_scan' | 'note_embedding';
export interface AINotification {
  id: string; action: NotificationAction; status: 'completed' | 'failed' | 'interrupted';
  vaultId: string; vaultName: string; pageId: string; pageTitle: string | null; available: boolean;
  createdAt: string; readAt: string | null;
}
export interface AIRunningActivity { id: string; action: NotificationAction; vaultId: string; pageId: string; pageTitle: string | null; available: boolean; startedAt: string }
export interface AINotificationQueue { items: AINotification[]; running: AIRunningActivity[]; unreadCount: number; through: number }
export function notificationMessage(item: Pick<AINotification,'action'|'status'|'pageTitle'>): string {
  const title=item.pageTitle || 'an unavailable page';
  const action={block_explanation:'AI explanation',page_title:'Title generation',page_summary:'Summary generation',entity_scan:'Entity scan',note_embedding:'Search indexing'}[item.action];
  if(item.status==='failed') return `${action} failed for ${title}`;
  if(item.status==='interrupted') return `${action} interrupted for ${title}`;
  return ({block_explanation:'Generated AI explanation for ',page_title:'Added title to ',page_summary:'Added summary to ',entity_scan:'Scanned entities in ',note_embedding:'Updated search index for '}[item.action])+title;
}
export function runningMessage(item: Pick<AIRunningActivity,'action'|'pageTitle'>): string {
  return ({block_explanation:'Explaining blocks in ',page_title:'Adding title to ',page_summary:'Summarizing ',entity_scan:'Scanning entities in ',note_embedding:'Indexing '}[item.action])+(item.pageTitle || 'Untitled');
}
