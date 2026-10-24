import {t} from '../i18n';
import {NoticeIcon} from './NoticeIcon';
import type {InlineNoticeProps} from './types';
/** Lifetime and resolution belong to the authoritative parent, never this surface. */
export function InlineNotice({id,tone,title,description,actions,variant='standard',dismissible=false,onDismiss,announcement='polite',className=''}:InlineNoticeProps) {return <div id={id} className={'inline-notice notice '+(variant==='compact'?'is-compact ':'')+className} data-tone={tone} role={announcement==='off'?undefined:announcement==='assertive'?'alert':'status'} aria-live={announcement==='off'?undefined:announcement}>
 <NoticeIcon tone={tone}/><div className="notice-content"><div className="notice-title">{title}</div>{description&&<div className="notice-description">{description}</div>}</div>{actions&&<div className="notice-actions">{actions}</div>}{dismissible&&onDismiss&&<button type="button" className="notice-close" aria-label={t('Dismiss notification')} onClick={onDismiss}>×</button>}
 </div>;}
