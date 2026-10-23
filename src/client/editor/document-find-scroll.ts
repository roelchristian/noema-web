/** Reveal the actual wrapped hit, leaving results already in view undisturbed. */
export function scrollDocumentFindMatch(range:Range,article:HTMLElement,panel:HTMLElement|null) {
 const rect=Array.from(range.getClientRects()).find(rect=>rect.width>0&&rect.height>0);
 if(!rect)return;
 const toolbar=article.closest('main')?.querySelector('.topbar');
 const top=Math.max(toolbar?.getBoundingClientRect().bottom??0,panel?.getBoundingClientRect().bottom??0)+16;
 const bottom=window.innerHeight-24;
 if(rect.top>=top&&rect.bottom<=bottom)return;
 const target=top+Math.max(0,bottom-top-rect.height)*.35;
 window.scrollTo({top:Math.max(0,window.scrollY+rect.top-target),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
