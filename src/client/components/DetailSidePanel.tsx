import type {ComponentPropsWithRef,ReactNode} from 'react';

type Props=ComponentPropsWithRef<'aside'>&{inspector?:boolean;toolbar:ReactNode;tabs?:ReactNode};
/** Shared panel frame for entity details, source information and reading activity. */
export function DetailSidePanel({inspector=false,toolbar,tabs,children,className='',...props}:Props){
  return <aside {...props} className={'entity-panel entity-detail-panel entity-editor-panel'+(inspector?' source-inspector':'')+(className?' '+className:'')}>
    {inspector?<div className="source-inspector-header">{toolbar}{tabs}</div>:toolbar}
    {children}
  </aside>;
}
