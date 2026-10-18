import {parse, type DefaultTreeAdapterMap} from 'parse5';
import {HttpError} from '../validation.js';

type Node=DefaultTreeAdapterMap['node'];
type Element=DefaultTreeAdapterMap['element'];
const attribute=(node:Node,name:string)=>'attrs' in node?node.attrs.find(attr=>attr.name===name)?.value:undefined;
const tag=(node:Node)=>'tagName' in node?node.tagName:'';
const children=(node:Node):Node[]=>'childNodes' in node?node.childNodes:[];
const omitted=new Set(['script','style','noscript','template','iframe','object','embed','svg','nav']);
const invisible=(node:Node)=>omitted.has(tag(node))||attribute(node,'hidden')!==undefined||attribute(node,'aria-hidden')==='true';
const plain=(node:Node):string=>invisible(node)?'':node.nodeName==='#text'&&'value' in node?node.value:children(node).map(plain).join('');
const compact=(value:string)=>value.replace(/\s+/g,' ').trim();
const escape=(value:string)=>value.replace(/\\/g,'\\\\').replace(/([`*_[\]<>])/g,'\\$1');
const backlink=(node:Node)=>attribute(node,'role')==='doc-backlink'||attribute(node,'class')?.split(/\s+/).includes('reversefootnote');
const delimiter=(value:string,minimum:number)=>'`'.repeat([...value.matchAll(/`+/g)].reduce((length,match)=>Math.max(length,match[0].length+1),minimum));

/** Inert HTML becomes semantic Markdown before citation lines are assigned.
 * IDs are mapped locally, rather than guessed by AI; no scripts or linked resources run. */
export function sourceHTML(html:string,sourceUrl:string):string {
 const document=parse(html.replace(/\u0000/g,'')),elements:Element[]=[];
 const walk=(node:Node,depth=0)=>{
  if(depth>256)throw new HttpError(415,'HTML nesting exceeds the safe import limit.');
  if(invisible(node))return;
  if('tagName' in node)elements.push(node);
  for(const child of children(node))walk(child,depth+1);
 };
 walk(document);
 const body=elements.find(node=>tag(node)==='body');
 if(!body)throw new HttpError(400,'No readable body text found at this URL.');
 const articles=elements.filter(node=>tag(node)==='article');
 const root=articles.length===1?articles[0]!:elements.find(node=>tag(node)==='main')??body;
 const contains=(ancestor:Node,node:Node):boolean=>{
  let current:Node|null=node;
  while(current){if(current===ancestor)return true;current='parentNode' in current?current.parentNode:null;}
  return false;
 };
 let baseUrl=sourceUrl;
 const base=elements.find(node=>tag(node)==='base');
 try{const url=new URL(attribute(base??body,'href')??sourceUrl,sourceUrl);if(['http:','https:'].includes(url.protocol))baseUrl=url.href;}catch{/* Ignore invalid base URLs. */}
 const byId=new Map(elements.filter(node=>attribute(node,'id')).map(node=>[attribute(node,'id')!,node]));
 const fragment=(href:string|undefined)=>{
  if(!href)return undefined;
  try {
   const url=new URL(href,baseUrl),base=new URL(sourceUrl);base.hash='';
   const id=decodeURIComponent(url.hash.slice(1));url.hash='';
   return id&&url.href===base.href?id:undefined;
  }catch{return undefined;}
 };
 const notes=new Map<Node,string>(),references=new Map<Node,string>();
 const isNote=(node:Node)=>['doc-endnote','doc-footnote'].includes(attribute(node,'role')??'')||/^(?:fn[:_-]?\d|fn:|footnote[:_-]?\d)/i.test(attribute(node,'id')??'');
 for(const node of elements)if(tag(node)==='a'&&!backlink(node)&&contains(root,node)) {
  const target=byId.get(fragment(attribute(node,'href'))??'');
  const ref=attribute(node,'role')==='doc-noteref'||attribute(node,'rel')?.split(/\s+/).includes('footnote')||attribute(node,'class')?.split(/\s+/).includes('footnote')||attribute(node.parentNode??node,'role')==='doc-noteref';
  if(target&&(ref||isNote(target))) {
   if(!notes.has(target))notes.set(target,String(notes.size+1));
   references.set(node,notes.get(target)!);
  }
 }
 // Keep explicitly marked notes even if the page contains no matching reference.
 for(const node of elements)if(contains(root,node)&&['doc-endnote','doc-footnote'].includes(attribute(node,'role')??'')&&!notes.has(node))notes.set(node,String(notes.size+1));
 const safeURL=(value:string|undefined)=>{
  if(!value)return undefined;
  try{const url=new URL(value,baseUrl);return ['http:','https:','mailto:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}
 };
 const render=(node:Node,inNote=false):string=>{
  if(invisible(node)||notes.has(node)&&!inNote)return '';
  if(node.nodeName==='#text'&&'value' in node)return escape(node.value.replace(/\s+/g,' '));
  const name=tag(node);
  if(backlink(node))return '';
  if(references.has(node))return `[^${references.get(node)}]`;
  const content=()=>children(node).map(child=>render(child,inNote)).join('');
  if(/^h[1-6]$/.test(name))return `\n\n${'#'.repeat(Number(name[1]))} ${compact(content())}\n\n`;
  if(name==='br')return '\n\n';
  if(name==='hr')return '\n\n---\n\n';
  if(name==='pre') {
   const literal=plain(node).replace(/\r\n?/g,'\n');
   const fence=delimiter(literal,3);
   return `\n\n${fence}\n${literal.trimEnd()}\n${fence}\n\n`;
  }
  if(name==='code') {
   const literal=plain(node),fence=delimiter(literal,1);
   return `${fence} ${literal.replace(/\s+/g,' ')} ${fence}`;
  }
  if(name==='blockquote') {
   const citation=safeURL(attribute(node,'cite'));
   return '\n\n'+(content().trim()+(citation?`\n\nSource: <${citation}>`:'')).split('\n').map(line=>'> '+line).join('\n')+'\n\n';
  }
  if(name==='ul'||name==='ol') {
   let number=Number(attribute(node,'start')??1);if(!Number.isSafeInteger(number))number=1;
   const items=children(node).filter(child=>tag(child)==='li').map(child=>{
    if(notes.has(child)&&!inNote)return '';
    const explicit=Number(attribute(child,'value'));if(name==='ol'&&attribute(child,'value')!==undefined&&Number.isSafeInteger(explicit))number=explicit;
    const marker=name==='ol'?`${number++}. `:'- ';
    const value=children(child).map(part=>render(part,inNote)).join('').trim();
    return value?marker+value.split('\n').map((line,index)=>index?' '.repeat(marker.length)+line:line).join('\n'):'';
   }).filter(Boolean);
   return '\n\n'+items.join('\n')+'\n\n';
  }
  if(name==='table') {
   const rows: string[][]=[];let hasHeader=false;
   const collect=(part:Node)=>{
    if(invisible(part))return;
    if(tag(part)==='tr') {
     const cells=children(part).filter(cell=>['td','th'].includes(tag(cell)));
     if(!rows.length)hasHeader=cells.some(cell=>tag(cell)==='th');
     rows.push(cells.map(cell=>compact(render(cell,inNote)).replace(/\|/g,'\\|')));
    }
    else for(const child of children(part))if(tag(child)!=='table')collect(child);
   };
   collect(node);
   const caption=children(node).find(child=>tag(child)==='caption');
   const width=rows.reduce((width,row)=>Math.max(width,row.length),0);
   if(!width)return content();
   const line=(row:string[])=>'| '+Array.from({length:width},(_,index)=>row[index]??'').join(' | ')+' |';
   return '\n\n'+(caption?compact(render(caption,inNote))+'\n\n':'')+[line(hasHeader?rows[0]!:[]),line(Array(width).fill('---')),...rows.slice(hasHeader?1:0).map(line)].join('\n')+'\n\n';
  }
  if(name==='a') {
   const href=safeURL(attribute(node,'href')),label=compact(content());
   return href&&label?`[${label}](<${href}>)`:label;
  }
  if(name==='img') {
   const alt=attribute(node,'alt'),url=safeURL(attribute(node,'src'));
   return alt?`\n\n${url?`![${escape(alt)}](<${url}>)`:`Image: ${escape(alt)}`}\n\n`:'';
  }
  if(name==='math') {
   const annotation=(part:Node):string|undefined=>tag(part)==='annotation'&&/tex/i.test(attribute(part,'encoding')??'')?plain(part):children(part).map(annotation).find(Boolean);
   const latex=annotation(node);
   return latex?attribute(node,'display')==='block'?`\n\n$$\n${latex}\n$$\n\n`:`$${latex}$`:escape(compact(plain(node)));
  }
  const value=content();
  if(name==='q') {
   const citation=safeURL(attribute(node,'cite'));
   return `“${value}”`+(citation?` ([source](<${citation}>))`:'');
  }
  if(name==='time'&&attribute(node,'datetime'))return `${value} (${escape(attribute(node,'datetime')!)})`;
  if(name==='abbr'&&attribute(node,'title'))return `${value} (${escape(attribute(node,'title')!)})`;
  if(['em','i'].includes(name))return value.trim()?`*${value.trim()}*`:value;
  if(['strong','b'].includes(name))return value.trim()?`**${value.trim()}**`:value;
  if(name==='del'||name==='s')return `~~${value}~~`;
  if(name==='sup'||name==='sub')return children(node).some(child=>references.has(child))?value:`<${name}>${value}</${name}>`;
  if(['p','div','section','article','header','footer','main','aside','figure','figcaption','dt','dd'].includes(name))return '\n\n'+value.trim()+'\n\n';
  return value;
 };
 // Many blog templates keep their article title/date in a separate sibling header.
 const header=elements.find(node=>tag(node)==='header'&&children(node).some(child=>tag(child)==='h1'));
 const title=elements.find(node=>tag(node)==='title');
 let text=(header&&!contains(root,header)?render(header):'')+render(root);
 if(!elements.some(node=>tag(node)==='h1'&&(contains(root,node)||!!header&&contains(header,node)))&&title)text='# '+escape(compact(plain(title)))+'\n\n'+text;
 const footnotes=[...notes].map(([node,id])=>{
  const value=render(node,true).trim();
  return value?`[^${id}]: `+value.split('\n').map((line,index)=>index?'    '+line:line).join('\n'):'';
 }).filter(Boolean);
 if(footnotes.length)text+='\n\n'+footnotes.join('\n\n');
 // Leave literal code untouched; normalize whitespace only outside fenced blocks.
 let fence:string|undefined;
 const lines=text.replace(/\r\n?/g,'\n').split('\n').map(line=>{
  const marker=line.match(/^(`{3,})/);
  if(marker){if(!fence)fence=marker[1];else if(marker[1]===fence)fence=undefined;return line;}
  return fence?line:line.trimEnd();
 });
 text=lines.join('\n').trim();
 if(!text)throw new HttpError(400,'No readable body text found at this URL.');
 return text;
}
