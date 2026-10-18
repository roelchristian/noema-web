import {useCallback,useLayoutEffect,useMemo,useRef,type Ref,type TextareaHTMLAttributes} from 'react';

type Props=Omit<TextareaHTMLAttributes<HTMLTextAreaElement>,'value'> & {value:string;inputRef?:Ref<HTMLTextAreaElement>;minHeight?:number;maxHeight?:number};
function highlightedLatex(source:string) {
  const tokens=/%[^\n]*|\\(?:[a-zA-Z]+|[^\n])|[{}\[\]()]|[_^&=+*/<>|!-]|(?:\d+(?:\.\d*)?|\.\d+)/g;
  const parts=[];let offset=0;
  for(const match of source.matchAll(tokens)) {
    if(match.index!>offset)parts.push(source.slice(offset,match.index));
    const token=match[0],kind=token.startsWith('%')?'comment':token.startsWith('\\')?'command':/^[\d.]/.test(token)?'number':/^[{}\[\]()]$/.test(token)?'bracket':'operator';
    parts.push(<span key={match.index} className={'latex-token-'+kind}>{token}</span>);
    offset=match.index!+token.length;
  }
  parts.push(source.slice(offset)+'\n');
  return parts;
}
/** Keep native textarea selection, IME and undo, with a decorative highlighted layer. */
export function LatexEditor({value,inputRef,minHeight=32,maxHeight=160,onScroll,className='',...props}:Props) {
  const field=useRef<HTMLTextAreaElement|null>(null),highlight=useRef<HTMLPreElement>(null);
  const content=useMemo(()=>highlightedLatex(value),[value]);
  const register=useCallback((element:HTMLTextAreaElement|null)=>{
    field.current=element;
    if(typeof inputRef==='function')inputRef(element);
    else if(inputRef)inputRef.current=element;
  },[inputRef]);
  useLayoutEffect(()=>{
    const textarea=field.current;if(!textarea)return;
    const resize=()=>{
      const scrollTop=textarea.scrollTop,scrollLeft=textarea.scrollLeft;
      textarea.style.height='0px';
      textarea.style.height=Math.min(maxHeight,Math.max(minHeight,textarea.scrollHeight))+'px';
      textarea.scrollTop=scrollTop;textarea.scrollLeft=scrollLeft;
      if(highlight.current){highlight.current.scrollTop=textarea.scrollTop;highlight.current.scrollLeft=textarea.scrollLeft;}
    };
    resize();
    let width=textarea.getBoundingClientRect().width;
    const observer=new ResizeObserver(()=>{
      const next=textarea.getBoundingClientRect().width;
      if(next!==width){width=next;resize();}
    });
    observer.observe(textarea);
    return()=>observer.disconnect();
  },[value,minHeight,maxHeight]);
  return <div className="latex-editor">
    <pre ref={highlight} className="latex-highlight" aria-hidden="true">{content}</pre>
    <textarea {...props} ref={register} rows={1} wrap="soft" spellCheck={false} autoCapitalize="off" autoCorrect="off" className={'latex-input '+className} value={value} onScroll={event=>{
      if(highlight.current){highlight.current.scrollTop=event.currentTarget.scrollTop;highlight.current.scrollLeft=event.currentTarget.scrollLeft;}
      onScroll?.(event);
    }}/>
  </div>;
}
