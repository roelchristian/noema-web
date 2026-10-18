import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {menuPlacement} from '../components/menu-placement';
import {EquationEditor} from './EquationEditor';

export function InlineMathEditor({initial,range,node,onSave,onClose,onMakeDisplay}:{onMakeDisplay?:(source:string)=>void;initial:string;range:Range;node?:HTMLElement;onSave:(source:string,restoreFocus?:boolean)=>void;onClose:()=>void}) {
  const [source,setSource]=useState(initial);
  const popup=useRef<HTMLDivElement>(null),finishing=useRef(false);
  const current=useRef({source,initial,onSave,onClose});current.current={source,initial,onSave,onClose};
  useLayoutEffect(()=>{
    const editor=popup.current;if(!editor)return;
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    const position=()=>{
      if(!range.commonAncestorContainer.isConnected){current.current.onClose();return;}
      const visible=window.visualViewport;
      const viewport={left:visible?.offsetLeft??0,top:visible?.offsetTop??0,width:visible?.width??innerWidth,height:visible?.height??innerHeight};
      const field=editor.querySelector('textarea');
      if(context&&field){const font=getComputedStyle(field);context.font=[font.fontStyle,font.fontWeight,font.fontSize,font.fontFamily].join(' ');}
      const textWidth=Math.max(...current.current.source.split('\n').map(line=>context?.measureText(line).width??line.length*7.2));
      const width=Math.max(0,Math.min(560,viewport.width-16,Math.max(260,textWidth+44)));
      editor.style.width=width+'px';
      const anchor=node?.isConnected?node.getBoundingClientRect():range.getBoundingClientRect();
      const placement=menuPlacement(anchor,width,editor.scrollHeight+editor.offsetHeight-editor.clientHeight,viewport,'start',300);
      editor.style.left=placement.left+'px';editor.style.top=placement.top+'px';editor.style.width=placement.width+'px';editor.style.maxHeight=placement.maxHeight+'px';
    };
    position();
    const observer=new ResizeObserver(position);observer.observe(editor);
    const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!editor.contains(event.target))position();};
    document.addEventListener('scroll',scroll,true);window.addEventListener('resize',position);
    window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    return()=>{observer.disconnect();document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);};
  },[range,node,source]);
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
  return createPortal(<div ref={popup} className="inline-math-editor equation-editor-shell" role="dialog" aria-modal="false" aria-label="Edit inline equation" onKeyDown={event=>{
    event.stopPropagation();
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();cancel();}
    else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();done();}
    else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();done();}
  }}>
    <EquationEditor value={source} onChange={setSource} label="Equation LaTeX" description="Click away or press Enter to apply. Escape cancels. Shift+Enter adds a line." onDone={done} doneDisabled={!source.trim()} conversion={onMakeDisplay?{
      label:'Make Display',disabled:!source.trim(),onClick:()=>{if(!finishing.current&&source.trim()){finishing.current=true;onMakeDisplay(source.trim());}},
    }:undefined}/>

  </div>,document.body);
}
