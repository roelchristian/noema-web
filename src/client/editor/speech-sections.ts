import type {Block,Entity} from '../../shared/domain';
import {speechText} from '../../shared/speech-text';

export interface SpeechSection {
  text:string;
  blockId:string;
  kind:'heading'|'paragraph'|'list'|'protected';
  /** Zero-based section within this stable block. */
  sectionIndex:number;
}

/** Selection identity ignores caret offsets and focus outside the editor. */
export function speechSelectionContext(root:HTMLElement,selection:Selection|null=document.getSelection()):string|null {
  if(!selection?.rangeCount)return null;
  const range=selection.getRangeAt(0);
  if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return null;
  function blockAt(node:Node,offset:number,end=false):string|null {
    const element=node instanceof Element?node:node.parentElement;
    const direct=element?.closest<HTMLElement>('[data-block-id]');
    if(direct&&root.contains(direct))return direct.dataset.blockId??null;
    // Select-all and cross-host ranges can use the editor as their endpoint.
    const child=node.childNodes[Math.max(0,end?offset-1:offset)];
    const childElement=child instanceof Element?child:child?.parentElement;
    const row=childElement?.matches('[data-block-id]')?childElement:childElement?.querySelector('[data-block-id]');
    return row?.getAttribute('data-block-id')??null;
  }
  const first=blockAt(range.startContainer,range.startOffset),last=blockAt(range.endContainer,range.endOffset,!range.collapsed);
  return first&&last?JSON.stringify([first,last]):null;
}

/** Run only on an explicit Speak action, never while the document is being edited. */
export function speechSections(blocks:Block[],ids:string[],entities:Entity[],limit=1800):SpeechSection[] {
  if(!Number.isInteger(limit)||limit<2||limit>4096)throw new Error('Invalid speech section limit.');
  const selected=new Set(ids),sections:SpeechSection[]=[];
  for(const block of blocks){
    if(!selected.has(block.id))continue;
    let rest=speechText([block],[block.id],entities),sectionIndex=0;
    const kind:SpeechSection['kind']=block.type==='code'||block.type==='math'||block.content.some(segment=>segment.code||segment.math)?'protected':block.type.startsWith('heading')?'heading':['bullet','numbered','todo'].includes(block.type)?'list':'paragraph';
    while(rest){
      let end=Math.min(limit,rest.length);
      if(end<rest.length){
        const boundary=Math.max(rest.lastIndexOf('\n',end-1),rest.lastIndexOf('. ',end-1),rest.lastIndexOf(' ',end-1));
        if(boundary>end/2)end=boundary+1;
        if(/[\uD800-\uDBFF]/.test(rest[end-1]!))end--;
      }
      sections.push({text:rest.slice(0,end),blockId:block.id,kind,sectionIndex:sectionIndex++});
      rest=rest.slice(end);
    }
  }
  return sections;
}

/** Exact selection revision; resume records contain no authored or transformed text. */
export async function resumeRevision(sections:SpeechSection[]):Promise<string> {
  const bytes=new TextEncoder().encode(JSON.stringify(sections.map(({text,blockId,kind,sectionIndex})=>[blockId,kind,sectionIndex,text])));
  const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}

type ResumeStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
function storage(value?:ResumeStorage):ResumeStorage {return value??window.localStorage;}
function resumeKey(vault:string,page:string) {return 'noema:speech-resume:v1:'+JSON.stringify([vault,page]);}

export function clearSpeechResume(vault:string,page:string,store?:ResumeStorage):void {
  try{storage(store).removeItem(resumeKey(vault,page));}catch{/* Playback remains available without browser storage. */}
}

export function readSpeechResume(vault:string,page:string,revision:string,sections:SpeechSection[],store?:ResumeStorage):number|null {
  try{
    const saved=JSON.parse(storage(store).getItem(resumeKey(vault,page))??'null');
    if(!saved)return null;
    if(saved.revision!==revision||!/^[a-f0-9]{64}$/.test(revision)){clearSpeechResume(vault,page,store);return null;}
    const index=sections.findIndex(section=>section.blockId===saved.blockId&&section.sectionIndex===saved.sectionIndex);
    if(index<0)clearSpeechResume(vault,page,store);
    return index<0?null:index;
  }catch{return null;}
}

export function writeSpeechResume(vault:string,page:string,revision:string,sections:SpeechSection[],index:number,store?:ResumeStorage):void {
  const section=sections[index];
  if(!section||!Number.isInteger(index)||!/^[a-f0-9]{64}$/.test(revision))return;
  try{storage(store).setItem(resumeKey(vault,page),JSON.stringify({revision,blockId:section.blockId,sectionIndex:section.sectionIndex}));}catch{/* Fail closed when browser storage is unavailable. */}
}
