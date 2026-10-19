import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Vision integration is opt-in because it requires Apple's system OCR services
// outside restrictive CI sandboxes. Geometry guards always run on macOS.
test('OCR region coverage rejects duplicate, partial-native and unrelated recovery matches',{skip:process.platform!=='darwin',timeout:180000},()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'noema-ocr-test-'));
 try{
  const executable=path.join(directory,'extract');
  execFileSync('/usr/bin/swiftc',[fileURLToPath(new URL('../scripts/extract-source.swift',import.meta.url)),'-module-cache-path',path.join(tmpdir(),'noema-swift-module-cache'),'-o',executable],{timeout:120000});
  assert.match(execFileSync(executable,['--test-coverage'],{encoding:'utf8'}),/safe recovery passed/);
  if(process.env.NOEMA_TEST_OCR==='1'){
   const builder=path.join(directory,'builder'),pdf=path.join(directory,'mixed.pdf');
   execFileSync('/usr/bin/swiftc',[fileURLToPath(new URL('./fixtures/source-ocr/make-mixed-pdf.swift',import.meta.url)),'-module-cache-path',path.join(tmpdir(),'noema-swift-module-cache'),'-o',builder],{timeout:120000});
   execFileSync(builder,[pdf]);
   const result=JSON.parse(execFileSync(executable,[pdf],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024}));
   assert.equal(result.ocrPages,1);
   assert.equal(result.pageEvidence[0].method,'mixed');
   assert.ok(result.text.includes('Embedded header with enough text to bypass the old threshold'));
   assert.ok(result.text.includes('Scanned body remains visible below the native header.'));
   assert.ok(result.text.includes('Dante as well.'));
   assert.ok(result.text.includes('Regan Arts.'));
   assert.ok(result.pageEvidence[0].coverage.detectedRegions>0);
   assert.ok(Array.isArray(result.pageEvidence[0].regions));
  }
  if(process.env.NOEMA_OCR_RASTER){
   const result=JSON.parse(execFileSync(executable,[path.resolve(process.env.NOEMA_OCR_RASTER)],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024}));
   assert.equal(result.ocrPages,5);
   for(const page of result.pageEvidence){
    const original=page.initialBlocks.map(block=>block.text);let cursor=0;
    for(const line of page.text.split('\n'))if(line===original[cursor])cursor++;
    assert.equal(cursor,original.length,'baseline OCR observations retain reading order');
   }
   for(const [page,text] of [[3,'p. 109).'],[4,'Dante as well.'],[5,'Regan Arts.']]){
    const evidence=result.pageEvidence[page-1];
    assert.ok(evidence.text.includes(text),`recovered page ${page}: ${text}`);
    const region=evidence.regions.find(region=>region.status==='recovered'&&region.recoveredText.includes(text));
    assert.ok(region,`recorded region provenance for ${text}`);
    assert.ok(region.bounds.every(Number.isFinite));
    assert.ok(region.bounds[0]>=0&&region.bounds[1]>=0&&region.bounds[0]+region.bounds[2]<=1&&region.bounds[1]+region.bounds[3]<=1);
   }
   assert.ok(result.pageEvidence.some(page=>page.coverage.unresolvedRegions>0),'unresolved observations are reported, not silently certified');
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});
