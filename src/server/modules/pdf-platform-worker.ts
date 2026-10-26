/** Private worker protocol: receives bytes on stdin, never file paths or secrets. */
import {PDFDocument} from 'pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {scanSourcePDF} from './source-import.js';
const limit=50*1024*1024;
let input=Buffer.alloc(0);
for await(const chunk of process.stdin){input=Buffer.concat([input,chunk]);if(input.length>limit*1.4)throw new Error('PDF worker input exceeds budget');}
const request=JSON.parse(input.toString('utf8')) as {operation:string;bytes:string;pages?:number[];page?:number};
const bytes=Buffer.from(request.bytes,'base64');if(bytes.length>limit)throw new Error('PDF exceeds budget');
if(request.operation!=='sanitize')scanSourcePDF(bytes);
const open=()=>getDocument({data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true,stopAtErrors:true,maxImageSize:16_000_000,useWorkerFetch:false});
let result:unknown;
if(request.operation==='count'){
 const document=await PDFDocument.load(bytes,{updateMetadata:false});result={pages:document.getPageCount()};
}else if(request.operation==='split'){
 const document=await PDFDocument.load(bytes,{updateMetadata:false}),out=await PDFDocument.create();
 const pages=request.pages!;if(!pages.length||pages.length>1000||pages.some(page=>!Number.isInteger(page)||page<1||page>document.getPageCount()))throw new Error('Invalid physical pages');
 for(const page of await out.copyPages(document,pages.map(page=>page-1)))out.addPage(page);
 const output=Buffer.from(await out.save({useObjectStreams:false,addDefaultPage:false}));scanSourcePDF(output);result={bytes:output.toString('base64'),pageMap:pages};
}else if(request.operation==='context'){
 const task=open(),document=await task.promise;try{
  const metadata=await document.getMetadata(),info=metadata.info as Record<string,unknown>;
  const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max):undefined;
  const title=clean(info.Title??metadata.metadata?.get('dc:title'),1000),language=clean(info.Language??metadata.metadata?.get('dc:language'),100);
  const sections:{page:number;title:string}[]=[];
  type OutlineItem={title:string;dest:string|unknown[]|null;items:OutlineItem[]};
  const outline=await document.getOutline(),queue:OutlineItem[]=(outline??[]) as OutlineItem[];let visited=0,total=0;
  // A bounded context hint, never a claim of complete document structure.
  while(queue.length&&visited++<512&&sections.length<256&&total<32000){
   const item=queue.shift()!;if(Array.isArray(item.items))queue.unshift(...item.items);
   const label=clean(item.title,300);if(!label)continue;
   const destination=typeof item.dest==='string'?await document.getDestination(item.dest):item.dest;
   if(!Array.isArray(destination)||!destination.length)continue;
   const reference=destination[0];let page:number;
   if(typeof reference==='number')page=reference+1;
   else if(reference&&typeof reference==='object'&&'num' in reference&&'gen' in reference)page=await document.getPageIndex(reference as {num:number;gen:number})+1;
   else continue;
   if(Number.isSafeInteger(page)&&page>=1&&page<=document.numPages){sections.push({page,title:label});total+=label.length;}
  }
  result={...(title?{title}:{}),...(language?{language}:{}),sections};
 }finally{await task.destroy();}
}else if(request.operation==='texts'){
 const task=open(),document=await task.promise;try{
  const pages=request.pages!;if(!Array.isArray(pages)||pages.length>32||new Set(pages).size!==pages.length||pages.some(page=>!Number.isSafeInteger(page)||page<1||page>document.numPages))throw new Error('Native evidence pages exceed bounded inspection limits');
  const output:{page:number;text:string;extractor:'pdfjs-dist/6.4.299'}[]=[];let total=0;
  for(const number of pages){const page=await document.getPage(number);try{
   const content=await page.getTextContent();let text='';
   for(const item of content.items)if('str' in item){text+=item.str+(item.hasEOL?'\n':' ');if(text.length>200000)throw new Error('Native text page exceeds evidence budget');}
   total+=text.length;if(total>1000000)throw new Error('Native evidence window exceeds text budget');
   output.push({page:number,text,extractor:'pdfjs-dist/6.4.299'});
  }finally{page.cleanup();}}
  result=output;
 }finally{await task.destroy();}
}else if(request.operation==='text'){
 const task=open(),document=await task.promise;try{const page=await document.getPage(request.page!);const content=await page.getTextContent();result={text:content.items.map(item=>'str' in item?item.str:'').join(' ')};}finally{await task.destroy();}
}else if(request.operation==='render'||request.operation==='sanitize'){
 const task=open(),document=await task.promise;try{
  if(document.numPages>1000)throw new Error('PDF page count exceeds raster budget');
  const out=request.operation==='sanitize'?await PDFDocument.create():undefined;
  const pages=out?Array.from({length:document.numPages},(_,index)=>index+1):[request.page!];
  for(const number of pages){const page=await document.getPage(number);const natural=page.getViewport({scale:1});const scale=Math.min(1.5,2400/Math.max(natural.width,natural.height));const viewport=page.getViewport({scale});
   if(viewport.width*viewport.height>6_000_000)throw new Error('Page image exceeds render budget');
   const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));const context=canvas.getContext('2d');
   await page.render({canvasContext:context as any,canvas:canvas as any,viewport}).promise;
   const image=canvas.toBuffer('image/png');
   if(!out){result={bytes:image.toString('base64')};break;}
   const embedded=await out.embedPng(image);const target=out.addPage([natural.width,natural.height]);target.drawImage(embedded,{x:0,y:0,width:natural.width,height:natural.height});page.cleanup();
  }
  if(out){const output=Buffer.from(await out.save({useObjectStreams:false}));if(output.length>limit)throw new Error('Raster reconstruction exceeds PDF budget');scanSourcePDF(output);result={bytes:output.toString('base64'),pages:document.numPages};}
 }finally{await task.destroy();}
}else throw new Error('Unsupported PDF worker operation');
process.stdout.write(JSON.stringify(result));
