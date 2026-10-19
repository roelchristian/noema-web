// Run: node --import tsx scripts/check-source-consistency.mjs [sample.pdf]
// With no argument, replay the committed native/OCR audit fixtures. With the
// supplied article, run the current native extractor twice in its restricted
// worker and verify deterministic text, headings, page ranges and provenance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeSourceText} from '../src/server/modules/source-text-normalization.ts';

const hash=value=>createHash('sha256').update(value).digest('hex');
function check(raw,{native=false}={}){
 const normalized=normalizeSourceText(raw.text,raw.structuralNodes??[],raw.pageStartLines??[]);
 assert.equal(raw.pages,5,'physical page count');
 assert.equal(normalized.structuralNodes.length,7,'six sections plus References');
 assert.equal(normalized.pageStartLines.length,5,'five normalized page boundaries');
 assert.deepEqual(normalized.structuralNodes.slice(0,6).map(node=>node.text.match(/^\d+/)?.[0]),['1','2','3','4','5','6']);
 const paragraphs=normalized.text.split(/\n\n/);
 const references=paragraphs.filter(block=>/^[\p{L}][^\n]{0,100}?\.\s+(?:1[5-9]|20)\d{2}[a-z]?\./u.test(block));
 assert.equal(references.length,13,'separate reference entries');
 const missing=['p. 109).','Dante as well.','Regan Arts.'].filter(span=>!normalized.text.includes(span));
 if(native){assert.deepEqual(missing,[],'all previously omitted spans restored');assert.equal(raw.ocrPages,0,'no unnecessary OCR');}
 let cursor=0;const coverage=new Uint8Array(raw.text.length);
 for(const entry of normalized.offsetMap){
  assert.equal(entry.normalizedStart,cursor,'continuous normalized mapping');cursor=entry.normalizedEnd;
  assert.ok(entry.rawStart>=0&&entry.rawEnd>=entry.rawStart&&entry.rawEnd<=raw.text.length);
  coverage.fill(1,entry.rawStart,entry.rawEnd);
  if(entry.kind==='text')assert.equal(normalized.text.slice(entry.normalizedStart,entry.normalizedEnd),raw.text.slice(entry.rawStart,entry.rawEnd));
 }
 assert.equal(cursor,normalized.text.length);
 for(let i=0;i<raw.text.length;i++)if(/\S/u.test(raw.text[i]))assert.equal(coverage[i],1,`raw character preserved at ${i}`);
 for(const line of normalized.pageStartLines)assert.match(normalized.text.split('\n')[line-1],/^<!-- Page \d+ -->$/);
 return {pages:raw.pages,ocrPages:raw.ocrPages,headings:normalized.structuralNodes.length,bibliographyEntries:references.length,rawCharacters:raw.text.length,rawTextHash:hash(raw.text),normalizedCharacters:normalized.text.length,mappedSpans:normalized.offsetMap.length,canonicalHash:hash(normalized.text),missingSourceSpans:missing};
}
const report={fixtures:{}};
for(const fixture of ['direct','flattened-extraction']){
 const raw=JSON.parse(readFileSync(new URL(`../test/fixtures/source-normalization/${fixture}.json`,import.meta.url),'utf8'));
 report.fixtures[fixture]=check(raw,{native:fixture==='direct'});
}
if(process.argv[2]){
 assert.equal(process.platform,'darwin','PDF validation requires macOS PDFKit');
 const input=realpathSync(path.resolve(process.argv[2]));
 const directory=realpathSync(mkdtempSync(path.join(tmpdir(),'noema-consistency-')));
 try{
  const executable=path.join(directory,'extractor');
  execFileSync('/usr/bin/swiftc',[fileURLToPath(new URL('./extract-source.swift',import.meta.url)),'-module-cache-path',path.join(tmpdir(),'noema-swift-module-cache'),'-o',executable],{timeout:120000});
  const profile='(version 1)(allow default)(deny network*)(deny file-write*)(deny process-fork)(deny process-exec)(allow process-exec (literal '+JSON.stringify(executable)+'))(deny file-read* (subpath "/Users"))(allow file-read* (literal '+JSON.stringify(input)+') (literal '+JSON.stringify(executable)+'))';
  const runs=[];
  for(let run=0;run<2;run++){
   const raw=JSON.parse(execFileSync('/usr/bin/sandbox-exec',['-p',profile,executable,input],{timeout:600000,maxBuffer:32*1024*1024,encoding:'utf8'}));
   const result=check(raw,{native:true});
   assert.equal(result.rawTextHash,report.fixtures.direct.rawTextHash,'native extraction matches the saved original-PDF baseline exactly');
   runs.push(result);
  }
  assert.equal(runs[0].canonicalHash,runs[1].canonicalHash,'repeat runs have identical normalized text');
  assert.deepEqual(runs[0],runs[1],'repeat runs have identical structure and mapping counts');
  report.pdf={sha256:hash(readFileSync(input)),consistent:true,runs};
 }finally{rmSync(directory,{recursive:true,force:true});}
}
console.log(JSON.stringify(report,null,2));
