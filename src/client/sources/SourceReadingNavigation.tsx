import {t as uiText} from '../i18n';
import {useEffect,useMemo,useRef,useState,type RefObject} from 'react';
import type {SourceDocument} from '../../shared/source-document';
import {sourceDocumentEntries} from '../../shared/source-document';
import {Icon} from '../components/Icon';

/** Collapsed furniture has no viewport position; its zero bounds must not
 * masquerade as a physical-page stop above the current reading position. */
export function visibleSourceNavigationLeaves(root:HTMLElement){
 return Array.from(root.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]')).filter(leaf=>!leaf.closest('[hidden]')&&!leaf.closest('details:not([open])')&&leaf.getClientRects().length>0).sort((a,b)=>Number(a.dataset.sourceStart)-Number(b.dataset.sourceStart));
}

interface Stop {offset:number;number:number}
interface Props {article:RefObject<HTMLElement|null>;text:string;document?:SourceDocument;activityAvailable?:boolean}
/** Use recorded physical pages when available; other documents navigate sections. */
export function SourceReadingNavigation({article,text,document:sourceDocument,activityAvailable=true}:Props) {
  const navigation=useMemo(()=>{
    const lines=[0];for(let index=0;index<text.length;index++)if(text[index]==='\n')lines.push(index+1);
    const offset=(line:number)=>lines[Math.max(0,line-1)]??text.length;
    const normalizedOffsets:number[]=[];
    if(text.includes('\r'))for(let index=0;index<text.length;index++){normalizedOffsets.push(index);if(text[index]==='\r'&&text[index+1]==='\n')index++;}
    const rawOffset=(value:number)=>normalizedOffsets.length?(normalizedOffsets[value]??text.length):value;
    const physical=sourceDocument?.physical.pages??[];
    if(physical.length)return {unit:'Page',stops:physical.map(page=>({offset:offset(page.range.startLine),number:page.number}))};
    const entries=sourceDocument?sourceDocumentEntries(sourceDocument):[];
    const headings=entries.filter(({node})=>node.title&&['chapter','section','subsection','heading'].includes(node.kind));
    const nodes=headings.length?headings:entries.filter(({node})=>node.text!==undefined);
    return {unit:headings.length?'Section':'Passage',stops:nodes.length?nodes.map(({node},index)=>({offset:rawOffset(node.range.startOffset),number:index+1})):[{offset:0,number:1}]};
  },[sourceDocument,text]);
  const [current,setCurrent]=useState(0),[left,setLeft]=useState<number|null>(null);
  const jump=useRef<(index:number)=>void>(()=>{});
  useEffect(()=>{
    const element=article.current;if(!element)return;const root=element;
    let frame=0,leaves:HTMLElement[]=[];
    // Endnotes keep raw offsets even though their DOM order changes.
    const refresh=()=>{leaves=visibleSourceNavigationLeaves(root);};
    function position(stop:Stop) {
      let low=0,high=leaves.length;
      while(low<high){const mid=(low+high)>>>1;if(Number(leaves[mid]!.dataset.sourceEnd)<=stop.offset)low=mid+1;else high=mid;}
      const leaf=leaves[Math.min(low,leaves.length-1)];
      if(!leaf)return root.getBoundingClientRect().top;
      if(!leaf.hasAttribute('data-source-atomic')&&leaf.firstChild?.nodeType===Node.TEXT_NODE) {
        const range=window.document.createRange(),index=Math.max(0,Math.min((leaf.firstChild.textContent??'').length,stop.offset-Number(leaf.dataset.sourceStart)));
        range.setStart(leaf.firstChild,index);range.collapse(true);
        const bounds=range.getBoundingClientRect();if(bounds.height)return bounds.top;
      }
      return leaf.getBoundingClientRect().top;
    }
    const cutoff=()=>((window.document.querySelector('.topbar')?.getBoundingClientRect().bottom??0)+24);
    function sync(){
      const main=root.closest('main')?.getBoundingClientRect();
      if(main)setLeft(Math.max(0,main.left)+(Math.min(window.innerWidth,main.right)-Math.max(0,main.left))/2);
      const edge=cutoff();let low=0,high=navigation.stops.length;
      while(low<high){const mid=(low+high)>>>1;if(position(navigation.stops[mid]!)<=edge+1)low=mid+1;else high=mid;}
      setCurrent(Math.max(0,low-1));
    }
    function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(sync);}
    refresh();sync();
    jump.current=index=>{
      const target=navigation.stops[index];if(!target)return;
      window.dispatchEvent(new Event('noema:before-reading-jump'));
      window.scrollBy({top:position(target)-cutoff(),behavior:'instant'});setCurrent(index);
    };
    const observer=new MutationObserver(()=>{refresh();schedule();});observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-source-start','data-source-end','hidden','open']});
    const resize=new ResizeObserver(()=>{refresh();schedule();});resize.observe(root);const main=root.closest('main');if(main)resize.observe(main);
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);jump.current=()=>{};};
  },[article,navigation]);
  if(!text.trim())return null;
  return <nav className="source-reading-navigation" aria-label={uiText("Source reading navigation")} style={{left:left??'50%'}}>
    <button type="button" className="source-reading-prev" aria-label={uiText("Previous {value0}",{value0: navigation.unit.toLowerCase()})} title={uiText("Previous {value0}",{value0: navigation.unit.toLowerCase()})} disabled={current===0} onClick={()=>jump.current(current-1)}><Icon name="chevron"/></button>
    <span aria-live="polite" aria-atomic="true">{navigation.unit} {navigation.stops[current]?.number??1} <span className="source-reading-total">/ {navigation.stops.length}</span></span>
    <button type="button" aria-label={uiText("Next {value0}",{value0: navigation.unit.toLowerCase()})} title={uiText("Next {value0}",{value0: navigation.unit.toLowerCase()})} disabled={current>=navigation.stops.length-1} onClick={()=>jump.current(current+1)}><Icon name="chevron"/></button>
    {activityAvailable&&<button type="button" className="source-bookmarks-toggle" title="Reading activity" aria-label="Reading activity" onClick={()=>window.dispatchEvent(new Event('noema:reading-bookmarks'))}><Icon name="reading-activity"/></button>}
  </nav>;
}
