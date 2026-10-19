import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SourceDocuments} from '../src/server/modules/source-documents.ts';
test('document cache invalidates when math uncertainty changes without a text change',()=>{
 let cached,writes=0,uncertainty=[{id:0,text:'uncertain symbol'}];
 const store={get(sql){
  if(sql.includes('SELECT 1 FROM vaults'))return {open:1};
  if(sql.includes('SELECT cleaned_text'))return {cleaned_text:'A formula $x$.'};
  if(sql.includes('SELECT raw_hash,uncertainty_json'))return {raw_hash:'a'.repeat(64),uncertainty_json:JSON.stringify(uncertainty)};
  if(sql.includes('SELECT document_json'))return cached;
 },run(_sql,_id,builder_version,input_hash,document_json){writes++;cached={builder_version,input_hash,document_json};}};
 const documents=new SourceDocuments(store),file={id:'file',vault_id:'vault',status:'ready',admitted:1,text:'A formula x.',structural_nodes:'[]',page_start_lines:'[]',pages:1,name:'Formula',original_filename:'formula.pdf',generated_name:null,format:'pdf',language:null,source_url:null,enrichment_status:'completed'};
 assert.equal(documents.get(file).processing.math.uncertain[0].text,'uncertain symbol');
 documents.get(file);assert.equal(writes,1);
 uncertainty=[{id:0,text:'review variable x'}];assert.equal(documents.get(file).processing.math.uncertain[0].text,'review variable x');assert.equal(writes,2);
});
