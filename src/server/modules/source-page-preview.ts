import type {sourcePageBlockTypes} from '../../shared/source-page.js';

/** Decode only complete JSON string characters; this provisional text is never saved. */
export function sourcePagePreview(record:string):{blockType:typeof sourcePageBlockTypes[number];text:string}|null {
  const prefix=/^\s*\{\s*"type"\s*:\s*"block"\s*,\s*"blockType"\s*:\s*"(paragraph|heading1|heading2|bullet|numbered|quote|code|math)"\s*,\s*"basis"\s*:\s*"(?:source|context|inference)"\s*,\s*"text"\s*:\s*"/.exec(record);
  if(!prefix)return null;
  const escapes:Record<string,string>={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
  let text='';
  for(let index=prefix[0].length;index<record.length;index++) {
    const character=record[index]!;
    if(character==='"')break;
    if(character==='\\') {
      const next=record[++index];if(next===undefined)break;
      if(next==='u') {
        const hex=record.slice(index+1,index+5);if(hex.length<4)break;
        if(!/^[0-9a-f]{4}$/i.test(hex))return null;
        text+=String.fromCharCode(parseInt(hex,16));index+=4;
      }else if(Object.hasOwn(escapes,next))text+=escapes[next];else return null;
    }else{if(character.charCodeAt(0)<32)return null;text+=character;}
    if(text.length>6000)return null;
  }
  // Hold a split surrogate pair until both characters have arrived.
  if(/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);
  return {blockType:prefix[1] as typeof sourcePageBlockTypes[number],text};
}
