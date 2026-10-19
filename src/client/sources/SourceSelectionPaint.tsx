import {useLayoutEffect,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';

interface SelectionBox {left:number;top:number;width:number;height:number}

function selectionShape({left,top,width,height}:SelectionBox) {
 const radius=Math.min(2,width/2,height/2),right=left+width,bottom=top+height;
 return `M${left+radius},${top}H${right-radius}Q${right},${top} ${right},${top+radius}V${bottom-radius}Q${right},${bottom} ${right-radius},${bottom}H${left+radius}Q${left},${bottom} ${left},${bottom-radius}V${top+radius}Q${left},${top} ${left+radius},${top}Z`;
}

/** Paint native selections within the same inline boxes used by saved highlights. */
export function SourceSelectionPaint({article}:{article:RefObject<HTMLElement|null>}) {
 const [boxes,setBoxes]=useState<SelectionBox[]>([]);
 useLayoutEffect(()=>{
  const root=article.current;if(!root)return;
  let frame=0,active=true;
  function measure() {
   if(!active||!root)return;
   const selection=getSelection(),next:SelectionBox[]=[];
   if(selection?.rangeCount&&!selection.isCollapsed) {
    const range=selection.getRangeAt(0);
    if(root.contains(range.startContainer)&&root.contains(range.endContainer)) {
     const bounds=root.getBoundingClientRect();
     for(const leaf of root.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]')) {
      if(!range.intersectsNode(leaf))continue;
      const part=range.cloneRange();
      if(!leaf.contains(range.startContainer))part.setStart(leaf,0);
      if(!leaf.contains(range.endContainer))part.setEnd(leaf,leaf.childNodes.length);
      // Inline element boxes exclude leading; range boxes alone can include it.
      const inlineBoxes=Array.from(leaf.getClientRects());
      const clip=leaf.closest('pre,.source-reader-table,.summary-math-display')?.getBoundingClientRect();
      for(const rect of part.getClientRects())for(const inline of inlineBoxes) {
       const left=Math.max(rect.left,inline.left,bounds.left,clip?.left??0,0);
       const right=Math.min(rect.right,inline.right,bounds.right,clip?.right??window.innerWidth,window.innerWidth);
       const top=Math.max(rect.top,inline.top,bounds.top,clip?.top??0,0);
       const bottom=Math.min(rect.bottom,inline.bottom,bounds.bottom,clip?.bottom??window.innerHeight,window.innerHeight);
       if(right>left&&bottom>top)next.push({left,top,width:right-left,height:bottom-top});
      }
     }
    }
   }
   root.classList.toggle('has-selection-paint',next.length>0);
   setBoxes(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
  }
  function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);}
  document.addEventListener('selectionchange',schedule);
  window.addEventListener('scroll',schedule,true);
  window.addEventListener('resize',schedule);
  const resize=new ResizeObserver(schedule);resize.observe(root);
  const mutation=new MutationObserver(schedule);mutation.observe(root,{childList:true,subtree:true});
  void document.fonts.ready.then(()=>{if(active)schedule();});
  measure();
  return()=>{
   active=false;cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();
   root.classList.remove('has-selection-paint');
   document.removeEventListener('selectionchange',schedule);
   window.removeEventListener('scroll',schedule,true);
   window.removeEventListener('resize',schedule);
  };
 },[article]);
 return boxes.length?createPortal(<svg className="source-selection-paint" aria-hidden="true" focusable="false">
  {/* One path avoids dark seams where adjacent or nested text boxes overlap. */}
  <path d={boxes.map(selectionShape).join('')}/>
 </svg>,document.body):null;
}
