import { pageIcons } from '../../shared/page-icons';
import { Icon } from './Icon';

/** A missing or unrecognized symbol always falls back to the default page icon. */
export function PageIcon({icon}: {icon?: string | null}) {
  const symbol = pageIcons.find(item => item.id === icon);
  return symbol ? <svg className="icon page-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={symbol.path}/></svg> : <Icon name="page"/>;
}
