import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../components/Icon';
import {menuPlacement} from '../components/menu-placement';
import {LatexEditor} from './LatexEditor';
import {renderMath} from './math';

export function InlineMathEditor({initial,range,node,onSave,onClose}:{initial:string;range:Range;node?:HTMLElement;onSave:(source:string,restoreFocus?:boolean)=>void;onClose:()=>void}) {
  const [source,setSource]=useState(initial);
  const popup=useRef<HTMLDivElement>(null),finishing=useRef(false);
  const current=useRef({source,initial,onSave,onClose});current.current={source,initial,onSave,onClose};
  useLayoutEffect(()=>{
    const editor=popup.current;if(!editor)return;
    const position=()=>{
      if(!range.commonAncestorContainer.isConnected){current.current.onClose();return;}
      const visible=window.visualViewport;
      const viewport={left:visible?.offsetLeft??0,top:visible?.offsetTop??0,width:visible?.width??innerWidth,height:visible?.height??innerHeight};
      editor.style.width=Math.max(0,Math.min(360,viewport.width-16))+'px';
      const anchor=node?.isConnected?node.getBoundingClientRect():range.getBoundingClientRect();
      const placement=menuPlacement(anchor,360,editor.scrollHeight+editor.offsetHeight-editor.clientHeight,viewport,'start',300);
      editor.style.left=placement.left+'px';editor.style.top=placement.top+'px';editor.style.width=placement.width+'px';editor.style.maxHeight=placement.maxHeight+'px';
    };
    position();
    const observer=new ResizeObserver(position);observer.observe(editor);
    const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!editor.contains(event.target))position();};
    document.addEventListener('scroll',scroll,true);window.addEventListener('resize',position);
    window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    return()=>{observer.disconnect();document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);};
  },[range,node]);
  useEffect(()=>{
    const leave=(event:Event)=>{
      if(finishing.current||!(event.target instanceof Node)||popup.current?.contains(event.target))return;
      finishing.current=true;
      const value=current.current;
      if(value.source.trim()&&value.source!==value.initial)value.onSave(value.source.trim(),false);
      else value.onClose();
    };
    document.addEventListener('pointerdown',leave,true);document.addEventListener('focusin',leave);
    return()=>{document.removeEventListener('pointerdown',leave,true);document.removeEventListener('focusin',leave);};
  },[]);
  function done() {
    if(finishing.current||!source.trim())return;
    finishing.current=true;onSave(source.trim());
  }
  function cancel() {
    finishing.current=true;onClose();
    if(node?.isConnected)node.focus({preventScroll:true});
    else if(range.commonAncestorContainer.isConnected){
      const container=range.commonAncestorContainer;
      const editor=(container instanceof Element?container:container.parentElement)?.closest<HTMLElement>('.block-content');
      editor?.focus({preventScroll:true});
      const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);
    }
  }
  return createPortal(<div ref={popup} className="inline-math-editor" role="dialog" aria-modal="false" aria-label="Edit inline equation" onKeyDown={event=>{
    event.stopPropagation();
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();cancel();}
    else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();done();}
    else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();done();}
  }}>
    <LatexEditor autoFocus aria-label="Equation LaTeX" aria-description="Click away or press Enter to apply. Escape cancels. Shift+Enter adds a line." minHeight={32} maxHeight={120} value={source} onChange={event=>setSource(event.target.value)} placeholder={'e.g. \\frac{a}{b}'} maxLength={10000}/>
    {source.trim()&&<div className="inline-math-preview" aria-label="Equation preview" dangerouslySetInnerHTML={{__html:renderMath(source)}}/>}
    <div className="math-block-source-footer"><span>LaTeX</span><div className="inline-math-editor-actions"><button type="button" className="math-block-done" onClick={cancel}>Cancel</button><button type="button" className="math-block-done" disabled={!source.trim()} onClick={done}><Icon name="check"/>Done</button></div></div>
  </div>,document.body);
}
