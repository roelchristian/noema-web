const highlights=new WeakMap<HTMLElement,Animation>();

/** A brief destination cue shared by citations and their bibliography backlinks. */
export function revealCitationTarget(target:HTMLElement|null) {
  if(!target)return;
  window.dispatchEvent(new Event('noema:before-reading-jump'));
  target.scrollIntoView({block:'center'});
  target.focus({preventScroll:true});
  highlights.get(target)?.cancel();
  const color=getComputedStyle(target).getPropertyValue('--citation-jump-highlight').trim()||'rgba(242,210,96,.24)';
  const wash={backgroundColor:color,boxShadow:`0 0 0 3px ${color}`};
  const animation=target.animate([
    {...wash,offset:0},
    {...wash,offset:.3},
    {backgroundColor:'transparent',boxShadow:'0 0 0 3px transparent',offset:1},
  ],{duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?1000:1800,easing:'ease-out'});
  highlights.set(target,animation);
  animation.onfinish=()=>{if(highlights.get(target)===animation)highlights.delete(target);};
}
