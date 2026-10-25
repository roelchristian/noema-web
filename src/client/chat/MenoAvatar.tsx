import {useEffect,useId,useRef,useState} from 'react';

/** Layered artwork keeps Meno's face upright while his satellites revolve. */
export function MenoAvatar({active=false}:{active?:boolean}) {
 const id=useId().replace(/:/g,'');
 const [playful,setPlayful]=useState(false),[engaged,setEngaged]=useState(false);
 const orbit=useRef<SVGGElement>(null),energy=useRef(false);
 energy.current=active||playful||engaged;
 useEffect(()=>{
  const root=orbit.current;if(!root)return;
  const layers=Array.from(root.querySelectorAll<SVGGElement>('[data-moon]'));
  const moons=[0,1,2].map(index=>({
   layers:layers.filter(node=>Number(node.dataset.moon)===index).map(node=>({node,tail:node.querySelector<SVGPathElement>('[data-tail]')!})),
   gradient:root.ownerSVGElement!.querySelector<SVGLinearGradientElement>(`[id="${id}-tail-${index}"]`)!,
  }));
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const phases=[2.8,.2,4.9],periods=[13.7,-19.3,23.9],radii=[55,43,61],heights=[29,49,24],tilts=[-18,36,-58];
  let frame=0,previous=0,time=0,speed=1;
  function paint(delta:number){
   time+=delta;speed+=( (energy.current?1.9:1)-speed)*(1-Math.exp(-delta*2.5));
   phases.forEach((phase,index)=>{
    // Integrate velocity so interaction accelerates without jumping around the orbit.
    phase+=delta*speed*(Math.PI*2/periods[index])*(1+.16*Math.sin(time*.43+index*2));phases[index]=phase;
    const tilt=(tilts[index]+9*Math.sin(time*.11+index))*Math.PI/180;
    const x=Math.cos(phase)*(radii[index]+2*Math.sin(time*.31+index));
    const y=Math.sin(phase)*(heights[index]+2*Math.cos(time*.23+index));
    const px=x*Math.cos(tilt)-y*Math.sin(tilt),py=x*Math.sin(tilt)+y*Math.cos(tilt);
    const depth=Math.sin(phase),scale=.82+.2*(depth+1)/2;
    const transform=`translate(${60+px} ${62+py}) scale(${scale})`;
    // The plume points away from Meno, with a little drag and a drifting solar-wind curl.
    const distance=Math.hypot(px,py),direction=Math.sign(periods[index]);
    const tx=(-Math.sin(phase)*radii[index]*Math.cos(tilt)-Math.cos(phase)*heights[index]*Math.sin(tilt))*direction;
    const ty=(-Math.sin(phase)*radii[index]*Math.sin(tilt)+Math.cos(phase)*heights[index]*Math.cos(tilt))*direction;
    const velocity=Math.hypot(tx,ty),windX=px/distance-.3*tx/velocity,windY=py/distance-.3*ty/velocity;
    const windLength=Math.hypot(windX,windY),ux=windX/windLength,uy=windY/windLength;
    const length=(index===1?36:28)*(1+.14*Math.sin(time*.9+index*2))*(1+.15*(speed-1));
    const curl=6*Math.sin(time*1.7+index*2.3)+3*Math.sin(time*.61+phase);
    const tipX=ux*length-uy*curl,tipY=uy*length+ux*curl;
    const midX=ux*length*.5+uy*curl*.5,midY=uy*length*.5-ux*curl*.5;
    const width=index===1?3.5:4.5;
    const tail=`M${-uy*width} ${ux*width} Q${midX-uy*width} ${midY+ux*width} ${tipX} ${tipY} Q${midX+uy*width} ${midY-ux*width} ${uy*width} ${-ux*width} Z`;
    moons[index].gradient.setAttribute('x2',String(tipX));moons[index].gradient.setAttribute('y2',String(tipY));
    for(const {node,tail:plume} of moons[index].layers){
     node.setAttribute('transform',transform);plume.setAttribute('d',tail);
     const front=node.dataset.layer==='front';
     node.style.visibility=(front?depth>=0:depth<0)?'visible':'hidden';
     node.style.opacity=String(.62+.38*(depth+1)/2);
    }
   });
  }
  function tick(now:number){const delta=previous?Math.min((now-previous)/1000,.05):0;previous=now;paint(delta);frame=requestAnimationFrame(tick);}
  function sync(){cancelAnimationFrame(frame);previous=0;paint(0);if(!motion.matches&&!document.hidden)frame=requestAnimationFrame(tick);}
  sync();motion.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
  return()=>{cancelAnimationFrame(frame);motion.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
 },[id]);
 const satellites=(layer:'back'|'front')=><g className="meno-satellites">{[8,6,7].map((radius,index)=><g key={index} data-moon={index} data-layer={layer} visibility="hidden"><path data-tail className="meno-comet-tail" fill={'url(#'+id+'-tail-'+index+')'}/><circle r={radius} fill={'url(#'+id+(index===1?'-gold)':'-moon)')}/></g>)}</g>;
 useEffect(()=>{if(!playful)return;const timer=window.setTimeout(()=>setPlayful(false),1800);return()=>window.clearTimeout(timer);},[playful]);
 return <button type="button" className="meno-avatar" data-active={active||playful||engaged} onPointerEnter={()=>setEngaged(true)} onPointerLeave={()=>setEngaged(false)} onFocus={()=>setEngaged(true)} onBlur={()=>setEngaged(false)} aria-label="Play with Meno" title="Hi, I’m Meno" onClick={()=>setPlayful(current=>!current)}>
  <svg viewBox="-12 -12 144 144" aria-hidden="true" focusable="false">
   <defs>
    {[0,1,2].map(index=><linearGradient key={index} id={id+'-tail-'+index} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="30" y2="0"><stop className={index===1?'meno-gold-light':'meno-mid'} stopOpacity=".8"/><stop offset=".45" className={index===1?'meno-gold-light':'meno-mid'} stopOpacity=".35"/><stop offset="1" className={index===1?'meno-gold-light':'meno-mid'} stopOpacity="0"/></linearGradient>)}
    <radialGradient id={id+'-body'} cx="68%" cy="20%" r="85%"><stop offset="0" className="meno-light"/><stop offset=".48" className="meno-mid"/><stop offset="1" className="meno-shade"/></radialGradient>
    <radialGradient id={id+'-moon'} cx="65%" cy="20%" r="90%"><stop className="meno-mid"/><stop offset="1" className="meno-shade"/></radialGradient>
    <radialGradient id={id+'-gold'} cx="65%" cy="20%" r="90%"><stop className="meno-gold-light"/><stop offset="1" className="meno-gold-shade"/></radialGradient>
   </defs>
   <g className="meno-float"><g className="meno-energy" ref={orbit}>
    {satellites('back')}
    <path fill={'url(#'+id+'-body)'} d="M26 42C39 23 62 17 78 26C94 35 100 54 96 72C92 91 75 103 54 101C32 100 20 87 20 69C20 59 21 51 26 42Z"/>
    <g className="meno-face" transform="rotate(-18 63 60)"><g className="meno-eyes">
     <ellipse cx="49" cy="64" rx="6.2" ry="9"/><ellipse cx="78" cy="61" rx="5.7" ry="8.7"/>
     <ellipse className="meno-glint" cx="51" cy="61" rx="1.9" ry="2.7"/><ellipse className="meno-glint" cx="80" cy="58" rx="1.8" ry="2.6"/>
    </g>
    </g>
    {satellites('front')}
   </g></g>
  </svg>
 </button>;
}
