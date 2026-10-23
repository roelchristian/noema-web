/** Shared upload and local text-extraction limits; pasted text remains a TXT original. */
export const maxSourceBytes=50*1024*1024;
export const maxSourceTextBytes=16*1024*1024;

/** A display filename only: source storage continues to use generated identifiers. */
export function pastedSourceFilename(title:string):string {
  let name=title.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,' ').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,' ').replace(/\s+/g,' ').trim().replace(/\.txt$/i,'').replace(/^[. ]+|[. ]+$/g,'');
  if(!name)name='Pasted text';
  // Leave room for the extension without cutting a Unicode surrogate pair.
  name=name.slice(0,196).replace(/[\uD800-\uDBFF]$/,'').replace(/[. ]+$/g,'');
  if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name.slice(0,195);
  return (name||'Pasted text')+'.txt';
}

/** Validate without trimming, normalizing, or otherwise changing original text. */
export function validatePastedSourceText(text:string):void {
  if(typeof text!=='string')throw new Error('Paste some source text before continuing.');
  // UTF-8 requires at least as many bytes as UTF-16 code units. Bound the scan
  // first, then count bytes without allocating an encoded copy.
  if(text.length>maxSourceTextBytes)throw new RangeError('Pasted source text must be 16 MB or smaller in UTF-8.');
  if(!text.trim())throw new Error('Paste some source text before continuing.');
  if(text.includes('\0'))throw new Error('Pasted source text cannot contain NUL characters.');
  let bytes=0;
  for(let index=0;index<text.length;index++){
    const unit=text.charCodeAt(index);
    if(unit>=0xd800&&unit<=0xdbff){
      const next=text.charCodeAt(++index);
      if(!(next>=0xdc00&&next<=0xdfff))throw new Error('Pasted source text contains invalid Unicode. Paste valid text without unpaired surrogate characters.');
      bytes+=4;
    }else if(unit>=0xdc00&&unit<=0xdfff)throw new Error('Pasted source text contains invalid Unicode. Paste valid text without unpaired surrogate characters.');
    else bytes+=unit<=0x7f?1:unit<=0x7ff?2:3;
    if(bytes>maxSourceTextBytes)throw new RangeError('Pasted source text must be 16 MB or smaller in UTF-8.');
  }
}
