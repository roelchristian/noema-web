import {t as uiText} from '../i18n';
import {useEffect,useId,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {TitleText} from '../components/TitleText';
import type {PageHeading} from './page-headings';

export function PageTableOfContents({headings,showDocument,articleRef}:{headings:PageHeading[];showDocument:boolean;articleRef:RefObject<HTMLElement|null>}) {
  const labelId=useId();
  const guide=useRef<HTMLElement>(null);
  const [active,setActive]=useState<string|null>(null);
  const [guideHost,setGuideHost]=useState<HTMLElement|null>(null);
  const [scrolling,setScrolling]=useState(false),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
  const showGuide=!!guideHost&&!!active&&(scrolling||hovered||focused);
  const [guidePresent,setGuidePresent]=useState(false);
  useEffect(()=>{
    if(showGuide){setGuidePresent(true);return;}
    const timeout=setTimeout(()=>setGuidePresent(false),window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:500);
    return()=>clearTimeout(timeout);
  },[showGuide]);
  useEffect(()=>{setGuideHost(document.getElementById('page-section-guide'));},[]);
  useEffect(()=>{
    const article=articleRef.current,content=article?.parentElement;
    if(!article||!content)return;
    setScrolling(false);
    const ids=new Set(headings.map(heading=>heading.id));
    const elements=[...article.querySelectorAll<HTMLElement>('[data-block-id]')].filter(element=>ids.has(element.dataset.blockId!));
    const toolbar=article.closest('main')?.querySelector('.topbar');
    let frame=0;
    let idle:ReturnType<typeof setTimeout>|undefined;
    let previousY=window.scrollY;
    const onScroll=()=>{
      if(window.scrollY!==previousY){
        previousY=window.scrollY;setScrolling(true);
        clearTimeout(idle);idle=setTimeout(()=>setScrolling(false),1600);
      }
      schedule();
    };
    const measure=()=>{
      frame=0;
      const top=(toolbar?.getBoundingClientRect().bottom??56)+24;
      const visible=elements.filter(element=>element.getClientRects().length>0);
      let current:string|null=null;
      for(const element of visible){
        if(element.getBoundingClientRect().top>top+24)break;
        current=element.dataset.blockId!;
      }
      // At the bottom, include the final short section even if it cannot reach the toolbar.
      if(window.scrollY>0&&window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-2)current=visible.at(-1)?.dataset.blockId??current;
      setActive(current);

    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);
    observer.observe(article);observer.observe(content);
    if(toolbar)observer.observe(toolbar);
    window.addEventListener('scroll',onScroll,{passive:true});
    window.addEventListener('resize',schedule);
    article.addEventListener('toggle',schedule,true);
    schedule();
    return()=>{cancelAnimationFrame(frame);clearTimeout(idle);observer.disconnect();window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',schedule);article.removeEventListener('toggle',schedule,true);};
  },[headings,articleRef]);
  useEffect(()=>{
    const nav=guide.current,button=nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if(!nav||!button)return;
    const bounds=button.getBoundingClientRect(),container=nav.getBoundingClientRect();
    if(bounds.top<container.top||bounds.bottom>container.bottom)nav.scrollTop+=bounds.top-container.top-nav.clientHeight/2;
  },[active,guidePresent]);
  function jump(id:string) {
    const article=articleRef.current;
    const target=[...(article?.querySelectorAll<HTMLElement>('[data-block-id]')??[])].find(element=>element.dataset.blockId===id);
    if(!target)return;
    for(let ancestor=target.parentElement;ancestor&&ancestor!==article;ancestor=ancestor.parentElement)if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;
    const toolbar=article?.closest('main')?.querySelector('.topbar');
    const top=window.scrollY+target.getBoundingClientRect().top-(toolbar?.getBoundingClientRect().height??56)-24;
    window.dispatchEvent(new Event('noema:before-reading-jump'));
    window.scrollTo({top,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    const heading=target.querySelector<HTMLElement>('.block-content');
    if(heading){
      if(!heading.isContentEditable){heading.tabIndex=-1;heading.addEventListener('blur',()=>heading.removeAttribute('tabindex'),{once:true});}
      heading.focus({preventScroll:true});
    }
    setActive(id);
  }
  const list=()=> <ol>{headings.map(heading=><li className={heading.level===2?'is-subheading':undefined} key={heading.id}><button type="button" aria-current={active===heading.id?'location':undefined} onClick={()=>jump(heading.id)} title={heading.title}><TitleText text={heading.title}/></button></li>)}</ol>;
  return <>
    {showDocument&&<nav className="page-toc page-toc-document" aria-labelledby={labelId}><h2 id={labelId}>{uiText("Table of contents")}</h2>{list()}</nav>}
    {guidePresent&&guideHost&&createPortal(<div className="page-toc-guide-presence" data-visible={showGuide}><div className="page-toc-guide-clip"><nav ref={guide} className="page-toc page-toc-guide" data-visible={showGuide} inert={!showGuide} aria-hidden={!showGuide} aria-label={uiText("Reading position")} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}}><div className="page-toc-guide-heading"><h2>{uiText("On this page")}</h2></div>{list()}</nav></div></div>,guideHost)}
  </>;
}
