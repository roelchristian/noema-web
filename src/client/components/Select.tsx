import { useLayoutEffect, useRef, type SelectHTMLAttributes } from 'react';
import { enhanceDropdowns } from './dropdowns';

/** Own the enhanced DOM inside an isolated host so React can safely update options. */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const host = useRef<HTMLSpanElement>(null);
  const control = useRef<ReturnType<typeof enhanceDropdowns> | null>(null);
  useLayoutEffect(() => {
    control.current = enhanceDropdowns(host.current!);
    return () => { control.current?.destroy(); control.current = null; };
  }, []);
  useLayoutEffect(() => { control.current?.refresh(); });
  return <span className="select-host" ref={host}><select {...props}/></span>;
}
