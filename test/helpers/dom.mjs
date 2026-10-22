import {JSDOM} from 'jsdom';

const globals=['window','document','Node','NodeFilter','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Range','DOMParser','InputEvent','MouseEvent','Event','CustomEvent','MutationObserver','getComputedStyle','getSelection','requestAnimationFrame','cancelAnimationFrame','innerWidth','innerHeight','IS_REACT_ACT_ENVIRONMENT'];
/** Small browser capability fixture. Register ownership before mounting React. */
export function setupDOM(t,{html='<div id="mount"></div>',rect={left:0,right:100,top:0,bottom:20,width:100,height:20}}={}) {
  const dom=new JSDOM(html,{url:'http://localhost',pretendToBeVisual:true});
  const previous=globals.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  const cleanups=[];let closed=false;
  const close=async()=>{
    if(closed)return;closed=true;
    const errors=[];
    try {for(const cleanup of cleanups.reverse()){try {await cleanup();}catch(error){errors.push(error);}}}
    finally {dom.window.close();globals.forEach((key,i)=>{if(previous[i])Object.defineProperty(globalThis,key,previous[i]);else delete globalThis[key];});}
    if(errors.length)throw new AggregateError(errors,'DOM fixture cleanup failed');
  };
  t?.after(close);
  for(const key of globals){
    const value=key==='IS_REACT_ACT_ENVIRONMENT'?true:['getSelection','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key];
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  dom.window.matchMedia=query=>({media:query,matches:false,onchange:null,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){},dispatchEvent(){return true;}});
  dom.window.HTMLElement.prototype.attachEvent=()=>{};dom.window.HTMLElement.prototype.detachEvent=()=>{};
  dom.window.Range.prototype.getBoundingClientRect=()=>({...rect});
  Object.defineProperty(dom.window.HTMLElement.prototype,'isContentEditable',{get(){return this.getAttribute('contenteditable')==='true';}});
  dom.window.document.queryCommandState=()=>false;
  return {dom,close,defer:cleanup=>cleanups.push(cleanup)};
}
