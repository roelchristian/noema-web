import type {ComponentPropsWithoutRef} from 'react';
import {Icon} from './Icon';

/** Keep native disclosure behavior with the sidebar's chevron affordance. */
export function DisclosureSummary({children,className='',...props}:ComponentPropsWithoutRef<'summary'>) {
  return <summary {...props} className={'disclosure-summary '+className}><Icon name="chevron"/><span className="disclosure-summary-label">{children}</span></summary>;
}
