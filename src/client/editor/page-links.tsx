import {t as uiText} from '../i18n';
import {TitleText} from '../components/TitleText';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ReactNode} from 'react';

import {pageLinks, type PageLinkMatch} from '../../shared/page-links';

function PageLink({link}:{link:PageLinkMatch}) {
  return <a className="note-link" href={'#page='+encodeURIComponent(link.title)} data-page-title={link.title} data-wikilink={link.source} contentEditable={false} draggable={false} title={uiText("Open note: ")+link.title}><TitleText text={link.label}/></a>;
}
export function pageLinkNodes(text:string):ReactNode[] {
  const nodes:ReactNode[]=[];let offset=0;
  for(const link of pageLinks(text)) {
    if(link.index>offset)nodes.push(text.slice(offset,link.index));
    nodes.push(<PageLink key={link.index} link={link}/>);offset=link.index+link.source.length;
  }
  if(offset<text.length)nodes.push(text.slice(offset));
  return nodes;
}
/** Turn a completed link beside the caret into an atomic link without losing its source. */
export function completePageLink(element:HTMLElement) {
  const selection=document.getSelection();
  if(!selection?.isCollapsed || !selection.rangeCount)return;
  const range=selection.getRangeAt(0),node=range.startContainer;
  if(node.nodeType!==Node.TEXT_NODE || !element.contains(node) || node.parentElement?.closest('code,a,[data-math],[data-entity]'))return;
  const before=(node.textContent??'').slice(0,range.startOffset);
  const link=pageLinks(before).find(link=>link.index+link.source.length===before.length);
  if(!link)return;
  const replacement=range.cloneRange();replacement.setStart(node,link.index);replacement.deleteContents();
  const wrapper=document.createElement('span');wrapper.innerHTML=renderToStaticMarkup(<PageLink link={link}/>);
  const anchor=wrapper.firstChild!;replacement.insertNode(anchor);
  const spacer=document.createTextNode('\u200b');anchor.after(spacer);replacement.setStart(spacer,1);replacement.collapse(true);
  selection.removeAllRanges();selection.addRange(replacement);
}
