import {entityMentionName,type Block,type Entity,type Segment} from './domain.js';

/** Strip reference-only notation while preserving authored words, numbers and punctuation. */
export function cleanSpeechText(value:string):string {
  let definition=false;
  const body=value.replace(/\r\n?/g,'\n').split('\n').filter(line=>{
    if(/^ {0,3}\[\^[^\]\n]+\]:/.test(line)){definition=true;return false;}
    if(definition&&(!line.trim()||/^(?: {4}|\t)/.test(line)))return false;
    definition=false;return true;
  }).join('\n');
  return body
    .replace(/\[\[([^\[\]\n|]+)(?:\|([^\]\n]*))?\]\]/g,(_match,title:string,label:string|undefined)=>label??title)
    .replace(/\[\^[^\]\n]+\]/g,'')
    .replace(/\[(?:ref|\?\?|L:\s*\d+(?:\s*[-–—,]\s*\d+)*)\]/gi,'')
    .replace(/[ \t\u00a0]+/g,' ')
    .replace(/ +([,.;:!?])/g,'$1')
    .replace(/^ +| +$/gm,'')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

/** Content projection: never serialize block tags, provenance, link targets or citation payloads. */
export function speechText(blocks:Block[],ids:string[],entities:Entity[]):string {
  const selected=new Set(ids);
  const text=(segments:Segment[])=>segments.map(segment=>{
    if(segment.sourceReference)return '';
    return segment.entityId?segment.mentionText??entityMentionName(entities.find(entity=>entity.id===segment.entityId))??'':segment.text??'';
  }).join('');
  return cleanSpeechText(blocks.filter(block=>selected.has(block.id)&&!['image','divider'].includes(block.type)).map(block=>
    block.type==='table'||block.type==='columns'?(block.rows??[]).map(row=>row.map(text).filter(value=>value.trim()).join('. ')).filter(value=>value.trim()).join('\n'):text(block.content)
  ).filter(value=>value.trim()).join('\n\n'));
}
