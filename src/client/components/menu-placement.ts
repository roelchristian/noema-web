interface Anchor {left:number;right:number;top:number;bottom:number}
interface Viewport {left:number;top:number;width:number;height:number}

export function menuPlacement(anchor:Anchor,width:number,height:number,viewport:Viewport,align:'start'|'end'='start',heightLimit=Infinity) {
  const gutter=8,gap=5,leftEdge=viewport.left+gutter,topEdge=viewport.top+gutter;
  const rightEdge=viewport.left+viewport.width-gutter,bottomEdge=viewport.top+viewport.height-gutter;
  const menuWidth=Math.min(width,Math.max(0,rightEdge-leftEdge));
  const above=Math.max(0,anchor.top-gap-topEdge),below=Math.max(0,bottomEdge-anchor.bottom-gap);
  const wanted=Math.min(height,heightLimit),upwards=below<wanted&&above>below;
  const maxHeight=Math.min(heightLimit,upwards?above:below),menuHeight=Math.min(height,maxHeight);
  const left=Math.max(leftEdge,Math.min(align==='end'?anchor.right-menuWidth:anchor.left,rightEdge-menuWidth));
  const top=Math.max(topEdge,Math.min(upwards?anchor.top-gap-menuHeight:anchor.bottom+gap,bottomEdge-menuHeight));
  return {left,top,width:menuWidth,maxHeight};
}

export function positionAnchoredMenu(menu:HTMLElement,trigger:HTMLElement,options:{align?:'start'|'end';minWidth?:number;maxHeight?:number}={}) {
  const visible=window.visualViewport;
  const viewport={left:visible?.offsetLeft??0,top:visible?.offsetTop??0,width:visible?.width??innerWidth,height:visible?.height??innerHeight};
  const anchor=trigger.getBoundingClientRect();
  if(anchor.bottom<=viewport.top||anchor.top>=viewport.top+viewport.height||anchor.right<=viewport.left||anchor.left>=viewport.left+viewport.width)return false;
  const width=Math.min(Math.max(anchor.width,options.minWidth??200),Math.max(0,viewport.width-16));
  menu.style.minWidth='0';menu.style.width=width+'px';menu.style.maxHeight='none';
  const height=menu.scrollHeight+menu.offsetHeight-menu.clientHeight;
  const placement=menuPlacement(anchor,width,height,viewport,options.align,options.maxHeight);
  menu.style.left=placement.left+'px';menu.style.top=placement.top+'px';menu.style.maxHeight=placement.maxHeight+'px';
  return true;
}

/** Scroll only the popup, never its sidebar or document ancestors. */
export function revealMenuItem(menu:HTMLElement,item:HTMLElement) {
  const top=item.offsetTop,bottom=top+item.offsetHeight,padding=5;
  if(top<menu.scrollTop+padding)menu.scrollTop=Math.max(0,top-padding);
  else if(bottom>menu.scrollTop+menu.clientHeight-padding)menu.scrollTop=bottom-menu.clientHeight+padding;
}
