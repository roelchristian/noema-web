import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { HttpError } from '../validation.js';
import type { SourceStructureNode } from '../../shared/domain.js';

const limit = 50 * 1024 * 1024;
export function scanSourcePDF(bytes: Buffer) {
  const pdf=bytes.toString('latin1');
  if(!/^%PDF-(?:1\.[0-9]|2\.0)(?:\r|\n)/.test(pdf) || !/%%EOF\s*$/.test(pdf))throw new HttpError(415,'The PDF is damaged or has unexpected trailing content.');
  // Decode escaped PDF names before screening. Object streams are rejected because
  // their dictionaries cannot be safely inspected by this conservative scanner.
  const names=pdf.match(/\/[^\s\x00()[\]<>\/%]+/g) ?? [];
  const blocked=new Set(['JavaScript','JS','AA','OpenAction','Launch','EmbeddedFile','EmbeddedFiles','Filespec','RichMedia','XFA','AcroForm','SubmitForm','ImportData','GoToR','GoToE','URI','Encrypt','ObjStm']);
  for(const raw of names) {
    const name=raw.slice(1).replace(/#([0-9a-f]{2})/gi,(_,hex:string)=>String.fromCharCode(parseInt(hex,16)));
    if(blocked.has(name))throw new HttpError(415,name==='ObjStm'?'PDF safety screening cannot inspect compressed object streams. Export a flattened PDF without object streams and try again.':'PDF safety screening rejected active content, embedded files, external actions, or encryption. Export a flattened PDF and try again.');
  }
}
function publicAddress(address:string) {
  if(isIP(address)!==4)return false; // IPv4 only: fail closed on IPv6/mapped-address ambiguity.
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b!>=16&&b!<=31||a===192&&(b===168||b===0||b===2)||a===100&&b!>=64&&b!<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113||a!>=224);
}
export function sourceURL(value:unknown): URL {
  if(typeof value!=='string'||value.length>4096)throw new HttpError(400,'Enter a source URL.');
  let url:URL;try{url=new URL(value);}catch{throw new HttpError(400,'Enter a valid HTTP or HTTPS URL.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&url.port!==(url.protocol==='https:'?'443':'80'))throw new HttpError(400,'Use a public HTTP or HTTPS URL without credentials or a custom port.');
  url.hash='';return url;
}
export async function fetchSource(value:unknown):Promise<{bytes:Buffer;name:string;url:string;structuralNodes?:SourceStructureNode[]}> {
  let url=sourceURL(value);
  const originalUrl=url.href;
  const signal=AbortSignal.timeout(30000);
  for(let redirects=0;redirects<=5;redirects++) {
    let addresses:Awaited<ReturnType<typeof lookup>>[];
    try {addresses=await lookup(url.hostname,{all:true,family:4});}catch{throw new HttpError(400,'Unable to resolve this source URL.');}
    if(signal.aborted)throw new HttpError(408,'Source download timed out.');
    if(!addresses.length||addresses.some(result=>!publicAddress(result.address)))throw new HttpError(400,'Source URLs must resolve to public internet addresses.');
    const address=addresses[0]!.address;
    const response=await new Promise<http.IncomingMessage>((resolve,reject)=>{
      const req=(url.protocol==='https:'?https:http).get(url,{signal,agent:false,family:4,lookup:(_hostname,_options,callback)=>callback(null,address,4),headers:{Accept:'text/html, application/pdf, text/plain, text/markdown','Accept-Encoding':'identity','User-Agent':'Noema source import'}},resolve);
      req.on('error',()=>reject(new HttpError(400,'Unable to download this source URL.')));
    });
    if([301,302,303,307,308].includes(response.statusCode??0)) {
      const location=response.headers.location;response.destroy();
      if(!location||redirects===5)throw new HttpError(400,'Too many redirects or missing redirect location.');
      url=sourceURL(new URL(location,url).href);continue;
    }
    if(response.statusCode!==200){response.destroy();throw new HttpError(400,'The source URL did not return a successful response.');}
    const mime=(response.headers['content-type']??'').split(';')[0]!.trim().toLowerCase();
    if(!['text/html','application/pdf','text/plain','text/markdown'].includes(mime)||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.destroy();throw new HttpError(415,'URL sources must return HTML, PDF, TXT, or Markdown without compression.');}
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of response){size+=chunk.length;if(size>limit){response.destroy();throw new HttpError(413,'Source files must be 50 MB or smaller.');}chunks.push(Buffer.from(chunk));}
    let bytes=Buffer.concat(chunks);
    let name:string;try{name=decodeURIComponent(url.pathname.split('/').at(-1)??'');}catch{name='source';}
    name=name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,220)||url.hostname;
    const extension=mime==='application/pdf'?'pdf':mime==='text/markdown'?'md':'txt';
    let structuralNodes:SourceStructureNode[]|undefined;
    if(mime==='text/html') {
      const charset=response.headers['content-type']?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]??'utf-8';
      let html:string;try{html=new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{throw new HttpError(415,'Unsupported or invalid HTML encoding.');}
      const document=parse(html);
      type Node=DefaultTreeAdapterMap['node'];
      const skip=new Set(['script','style','noscript','template','iframe','object','embed','svg','math']);
      const blocks=new Set(['p','div','section','article','header','footer','main','li','br','h1','h2','h3','h4','h5','h6','tr','blockquote','pre']);
      const parts:string[]=[];
      const visit=(node:Node,inBody=false,depth=0):void=>{
        if(depth>256)throw new HttpError(415,'HTML nesting exceeds the safe import limit.');
        if('tagName' in node){if(skip.has(node.tagName)||node.attrs.some(attr=>attr.name==='hidden'||attr.name==='aria-hidden'&&attr.value==='true'))return;inBody ||= node.tagName==='body';if(inBody&&blocks.has(node.tagName))parts.push('\n');if(inBody&&/^h[1-6]$/.test(node.tagName))parts.push('\u0000'+node.tagName+'\u0000');}
        if(inBody&&node.nodeName==='#text'&&'value' in node)parts.push(node.value.replace(/\u0000/g,''));
        if('childNodes' in node)for(const child of node.childNodes)visit(child,inBody,depth+1);
        if(inBody&&'tagName' in node&&blocks.has(node.tagName))parts.push('\n');
      };
      visit(document);
      const lines=parts.join('').replace(/\r\n?/g,'\n').replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim().split('\n');
      structuralNodes=[];
      const text=lines.map((line,index)=>{
        const heading=line.match(/\u0000h([1-6])\u0000/);
        const clean=line.replace(/\u0000h[1-6]\u0000/g,'');
        if(heading&&clean.trim())structuralNodes!.push({text:clean.trim(),startLine:index+1,level:Number(heading[1])});
        return clean;
      }).join('\n');
      bytes=Buffer.from(text);
      if(!bytes.length)throw new HttpError(400,'No readable body text found at this URL.');
    }
    if(!name.toLowerCase().endsWith('.'+extension))name=name.replace(/\.(html?|pdf|txt|md)$/i,'')+'.'+extension;
    return {bytes,name,url:originalUrl,structuralNodes};
  }
  throw new HttpError(400,'Unable to download source.');
}
