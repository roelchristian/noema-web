import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chatCorpus} from './helpers/chat-corpus.mjs';
import {Chat} from '../src/server/modules/chat.ts';
const tables=['pages','entities','properties','relationships','entity_overviews','source_files','page_sources','entity_page_associations','page_page_associations'];
test('saved Chat changes only conversation storage and transcripts never become retrieval evidence',async()=>{
 const f=chatCorpus();let chat;
 try {
  const snapshot=()=>Object.fromEntries(tables.map(table=>[table,JSON.stringify(f.store.all(`SELECT * FROM ${table} ORDER BY rowid`))]));
  const before=snapshot();
  const ai={selection:()=>({model:'synthetic',reasoningEffort:'none'}),async generate(request){const {evidence}=JSON.parse(request.input);return JSON.stringify({claims:[{text:'The source records a claim about grace.',attribution:'supported',citationIds:[evidence.find(item=>item.kind==='source').id]}]});}};
  chat=new Chat(f.store,ai,f.retrieval,f.vaults);
  const result=await chat.submit('default',{question:'grace unfindablemonotokenchat789',scope:{kind:'vault'},requestId:randomUUID()});
  assert.ok(result.threadId);assert.equal(f.store.get('SELECT count(*) n FROM chat_messages').n,2);assert.deepEqual(snapshot(),before);
  const transcriptSearch=await f.retrieval.retrieve('default',{kind:'vault'},'unfindablemonotokenchat789');assert.deepEqual(transcriptSearch.evidence,[]);
  chat.storage.rename('default',result.threadId,'Changed conversation title');chat.storage.remove('default',result.threadId);assert.deepEqual(snapshot(),before);
 }finally{chat?.close();f.close();}
});
