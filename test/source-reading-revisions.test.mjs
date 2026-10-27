import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createApp} from '../src/server/http.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceReading} from '../src/server/modules/source-reading.ts';
import {processedSourceDocument} from '../src/server/modules/source-document.ts';
import {materializeSourceRevision,sourceRevisionBaseHash} from '../src/server/modules/source-reprocessing.ts';
import {sourceTextHash} from '../src/server/modules/source-math-text.ts';

async function fixture(t){
 const directory=mkdtempSync(path.join(tmpdir(),'noema-reading-revisions-')),db=openDatabase(path.join(directory,'db.sqlite')),store=new Store(db),files=new SourceFiles(store),reading=new SourceReading(store);
 t.after(()=>{files.close();db.close();rmSync(directory,{recursive:true,force:true});});
 const added=files.add('default','annotation-revisions.md',Buffer.from('# Synthetic geometry\n\nA brief introduction.\n\nA fictional triangle has three invented sides and supports a unique geometric proof.\n\nA closing observation gives enough distinct context to resolve the saved reading position.'));
 const source=new Knowledge(store).create('default',{type:'source',name:'Synthetic geometry',attachmentIds:[added.id]});await files.tick();
 const file=files.require('default',added.id),original={text:file.text,document:processedSourceDocument(file)};
 function selection(text,excerpt,revisionId){const startOffset=text.indexOf(excerpt);assert.ok(startOffset>=0);return {sourceId:source.id,fileId:file.id,sourceHash:sourceTextHash(text),startOffset,endOffset:startOffset+excerpt.length,excerpt,...(revisionId?{revisionId}:{})};}
 function revision(edits){
  const id=randomUUID(),timestamp=new Date().toISOString(),r={id,fileId:file.id,createdAt:timestamp,updatedAt:timestamp,status:'completed',instructions:'Synthetic annotation persistence fixture',baseHash:sourceRevisionBaseHash(original),stale:false,original:structuredClone(original),reprocessed:structuredClone(original),patches:edits.map(([before,after])=>{const startOffset=file.text.indexOf(before);assert.ok(startOffset>=0);return {id:randomUUID(),nodeIds:[],range:{startOffset,endOffset:startOffset+before.length,startLine:1,endLine:1},original:before,replacement:after,category:'formatting',reason:'Synthetic revision fixture',confidence:1,decision:'accepted'};}),report:{promptVersion:'fixture',model:'fixture',reasoningEffort:'low',startedAt:timestamp,finishedAt:timestamp,durationMs:0,chunksTotal:1,chunksCompleted:1,charactersTotal:file.text.length,charactersReviewed:file.text.length,inputTokens:null,outputTokens:null,reasoningTokens:null,cachedInputTokens:null,diagnostics:[],error:null}};
  materializeSourceRevision(r);
  store.run('INSERT INTO source_reprocessing (id,file_id,vault_id,status,created_at,updated_at,payload) VALUES (?,?,?,?,?,?,?)',id,file.id,'default','completed',timestamp,timestamp,JSON.stringify(r));return r;
 }
 return {store,files,reading,file,source,original,selection,revision};
}
const passage='A fictional triangle has three invented sides and supports a unique geometric proof.';

test('notes and highlights follow accepted edits and changed line breaks across reading versions without rewriting originals',async t=>{
 const f=await fixture(t),{reading,file,store}=f,selected=f.selection(file.text,passage);
 const note=reading.createReadingNote('default',file.id,{...selected,text:'The invented triangle is the key example.'});
 const highlight=reading.createHighlight('default',file.id,{...selected,color:'purple'});
 const originalRows={note:store.get('SELECT * FROM page_reading_notes WHERE page_id=?',note.id),highlight:store.get('SELECT * FROM highlights WHERE id=?',highlight.id)};
 const first=f.revision([['A brief introduction.','An expanded introductory paragraph with more context.'],['three invented sides','three carefully invented\n\nsides']]);
 const second=f.revision([['A brief introduction.','A shorter opening.'],['three invented sides','three imagined sides']]);
 for(const revision of [first,second,first]){
  const notes=reading.listReadingNotes('default',file.id,revision.id),highlights=reading.list('default',file.id,revision.id),expected=revision.reprocessed.text.indexOf('A fictional triangle');
  assert.equal(notes.length,1);assert.equal(notes[0].pageId,note.id);assert.equal(notes[0].startOffset,expected);assert.equal(notes[0].sourceHash,sourceTextHash(revision.reprocessed.text));assert.equal(notes[0].text,'The invented triangle is the key example.');
  assert.equal(highlights.length,1);assert.equal(highlights[0].id,highlight.id);assert.equal(highlights[0].color,'purple');assert.equal(highlights[0].startOffset,expected);assert.equal(highlights[0].excerpt,revision.reprocessed.text.slice(highlights[0].startOffset,highlights[0].endOffset));assert.match(highlights[0].excerpt,/unique geometric proof\.$/);
 }
 assert.equal(reading.listReadingNotes('default',file.id)[0].startOffset,selected.startOffset);
 assert.equal(reading.list('default',file.id)[0].excerpt,passage);
 assert.deepEqual(store.get('SELECT * FROM page_reading_notes WHERE page_id=?',note.id),originalRows.note);
 assert.deepEqual(store.get('SELECT * FROM highlights WHERE id=?',highlight.id),originalRows.highlight);
});

test('annotations created in a revision remain attached in original and other versions after that revision is removed',async t=>{
 const f=await fixture(t),{reading,file,store}=f,first=f.revision([['three invented sides','three carefully invented sides']]),second=f.revision([['A brief introduction.','A much longer introduction that shifts every later passage.']]);
 const selected=f.selection(first.reprocessed.text,passage.replace('three invented sides','three carefully invented sides'),first.id);
 const note=reading.createReadingNote('default',file.id,{...selected,text:'Added while reading the revised example.'}),highlight=reading.createHighlight('default',file.id,{...selected,color:'green'});
 assert.equal(reading.listReadingNotes('default',file.id,first.id)[0].sourceHash,selected.sourceHash);
 assert.equal(reading.list('default',file.id,first.id)[0].excerpt,selected.excerpt);
 store.run('DELETE FROM source_reprocessing WHERE id=?',first.id);
 const originalNote=reading.listReadingNotes('default',file.id).find(item=>item.pageId===note.id),originalHighlight=reading.list('default',file.id).find(item=>item.id===highlight.id);
 assert.equal(originalNote.sourceHash,sourceTextHash(file.text));assert.equal(originalNote.startOffset,file.text.indexOf(passage));assert.equal(originalHighlight.excerpt,passage);
 assert.equal(reading.listReadingNotes('default',file.id,second.id)[0].startOffset,second.reprocessed.text.indexOf(passage));
});

test('bookmarks saved in either version project through accepted changes and keep canonical storage',async t=>{
 const f=await fixture(t),{reading,file,store}=f,r=f.revision([['A brief introduction.','An expanded introduction shifts the passage below.'],['three invented sides','three imagined sides']]);
 const originalOffset=file.text.indexOf(passage),revisedOffset=r.reprocessed.text.indexOf('A fictional triangle'),id=randomUUID();
 reading.saveLocation('default',file.id,id,{revision:sourceTextHash(file.text),offset:originalOffset,label:'Original bookmark'});
 const projected=reading.continuity('default',file.id,r.id).bookmarks[0];assert.equal(projected.resolution.status,'resolved');assert.equal(projected.resolution.offset,revisedOffset);
 const beforeUnscoped=store.all('SELECT * FROM source_reading_locations WHERE file_id=?',file.id);
 assert.throws(()=>reading.saveLocation('default',file.id,randomUUID(),{revision:sourceTextHash(r.reprocessed.text),offset:revisedOffset,label:'Unscoped edited coordinate'}),error=>error.status===409,'Edited coordinates without a revision ID cannot enter canonical storage');
 assert.deepEqual(store.all('SELECT * FROM source_reading_locations WHERE file_id=?',file.id),beforeUnscoped,'Rejected unscoped writes leave canonical anchors intact');
 const secondId=randomUUID();reading.saveLocation('default',file.id,secondId,{revisionId:r.id,revision:sourceTextHash(r.reprocessed.text),offset:revisedOffset,label:'Revised bookmark'});
 assert.equal(reading.continuity('default',file.id).bookmarks.find(item=>item.id===secondId).resolution.offset,originalOffset);
 const saved=JSON.parse(store.get('SELECT anchor_json FROM source_reading_locations WHERE file_id=? AND id=?',file.id,secondId).anchor_json);assert.equal(saved.revision,sourceTextHash(file.text));
});

test('unknown, incomplete and stale revisions cannot read or save annotation coordinates',async t=>{
 const f=await fixture(t),{reading,file,store}=f,r=f.revision([['three invented sides','three imagined sides']]);
 for(const method of ['list','listReadingNotes','continuity'])assert.throws(()=>reading[method]('default',file.id,randomUUID()),{status:404});
 const selected=f.selection(r.reprocessed.text,passage.replace('three invented sides','three imagined sides'),r.id);
 store.run("UPDATE source_reprocessing SET status='running',payload=json_set(payload,'$.status','running') WHERE id=?",r.id);
 assert.throws(()=>reading.createHighlight('default',file.id,{...selected,color:'yellow'}),{status:409});
 store.run("UPDATE source_reprocessing SET status='completed',payload=json_set(payload,'$.status','completed') WHERE id=?",r.id);
 store.run('UPDATE source_files SET text=? WHERE id=?','Changed canonical content.\n'+file.text,file.id);
 assert.throws(()=>reading.listReadingNotes('default',file.id,r.id),{status:409});
 assert.throws(()=>reading.createReadingNote('default',file.id,{...selected,text:'This must not save.'}),{status:409});
 assert.equal(store.get('SELECT count(*) AS n FROM page_reading_notes WHERE file_id=?',file.id).n,0);
});


test('HTTP annotation endpoints honor revision queries, writes and vault boundaries',async t=>{
 const f=await fixture(t),{reading,file,store}=f,r=f.revision([['A brief introduction.','An expanded opening changes later offsets.']]);
 reading.createReadingNote('default',file.id,{...f.selection(file.text,passage),text:'A note created in the original.'});
 const server=createApp(store,path.resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port+'/api/source-files/'+file.id,headers={'X-Noema-Request':'1','Content-Type':'application/json','X-Vault-Id':'default'};
 async function send(method,suffix,body,customHeaders=headers){return fetch(base+suffix,{method,headers:customHeaders,body:body===undefined?undefined:JSON.stringify(body)});}
 const noteResponse=await send('GET','/reading-notes?revisionId='+r.id);assert.equal(noteResponse.status,200);
 const notes=await noteResponse.json();assert.equal(notes[0].startOffset,r.reprocessed.text.indexOf(passage));assert.equal(notes[0].sourceHash,sourceTextHash(r.reprocessed.text));
 const highlightResponse=await send('POST','/highlights',{...f.selection(r.reprocessed.text,passage,r.id),color:'blue'});assert.equal(highlightResponse.status,201);
 const savedHighlight=await highlightResponse.json();assert.equal(savedHighlight.sourceHash,sourceTextHash(r.reprocessed.text));
 const listResponse=await send('GET','/highlights?revisionId='+r.id);assert.equal(listResponse.status,200);assert.equal((await listResponse.json())[0].startOffset,r.reprocessed.text.indexOf(passage));
 const bookmarkId=randomUUID(),bookmarkResponse=await send('PUT','/reading-locations/'+bookmarkId,{revisionId:r.id,revision:sourceTextHash(r.reprocessed.text),offset:r.reprocessed.text.indexOf(passage),label:'Revision bookmark'});assert.equal(bookmarkResponse.status,200);
 const continuity=await (await send('GET','/reading-locations?revisionId='+r.id)).json();assert.equal(continuity.bookmarks[0].resolution.offset,r.reprocessed.text.indexOf(passage));
 const other=new Vaults(store).create({name:'Annotation boundary fixture'});
 for(const suffix of ['/reading-notes','/highlights','/reading-locations']){
  assert.equal((await send('GET',suffix+'?revisionId='+randomUUID())).status,404);
  assert.equal((await send('GET',suffix+'?revisionId='+r.id,undefined,{...headers,'X-Vault-Id':other.id})).status,404);
 }
});
