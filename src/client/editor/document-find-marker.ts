/** Follow the active text range as wrapping, scrolling and document layout change. */
export function trackDocumentFindMarker(marker:HTMLElement,article:HTMLElement,block:HTMLElement,range:Range) {
 marker.dataset.followingScroll='false';
 let frame=0,disposed=false;
 const update=()=>{
  frame=0;if(disposed)return;
  const rect=Array.from(range.getClientRects()).find(rect=>rect.width>0&&rect.height>0);
  if(!rect){marker.dataset.visible='false';return;}
  const center=rect.top+rect.height/2;
  const toolbarBottom=article.closest('main')?.querySelector('.topbar')?.getBoundingClientRect().bottom??0;
  const controls=block.querySelector<HTMLElement>(':scope > .block-controls');
  const gutter=controls?.getClientRects().length?controls.getBoundingClientRect().left:block.getBoundingClientRect().left-18;
  marker.style.left=`${Math.max(6,gutter+6)}px`;
  marker.style.top=`${center}px`;
  marker.hidden=false;marker.dataset.visible=String(center>=toolbarBottom+6&&center<=window.innerHeight-6);
 };
 const schedule=(event?:Event)=>{if(event?.type==='scroll')marker.dataset.followingScroll='true';if(!frame)frame=requestAnimationFrame(update);};
 update();
 const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>schedule());
 observer?.observe(article);observer?.observe(block);
 document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);
 document.fonts?.addEventListener('loadingdone',schedule);
 return(hide=true)=>{disposed=true;cancelAnimationFrame(frame);observer?.disconnect();document.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);document.fonts?.removeEventListener('loadingdone',schedule);if(hide){marker.dataset.visible='false';marker.hidden=true;}};
}
