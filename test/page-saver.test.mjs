import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PageSaver } from '../src/client/state/page-saver.ts';
const page = (vault='vault-a', title='First draft') => ({id:'note',vault_id:vault,title,revision:1,blocks:[],sourceIds:[],updated_at:'2026-10-16'});
test('autosave serializes edits made during a write and advances the next revision', async () => {
  const sent=[],saved=[],statuses=[];let completeFirst;
  const saver=new PageSaver(async snapshot=>{
    sent.push(structuredClone(snapshot));
    if(sent.length===1)return await new Promise(resolve=>{completeFirst=resolve;});
    return {...snapshot,revision:snapshot.revision+1};
  },value=>saved.push(value),(status)=>statuses.push(status));
  try {
    saver.enqueue(page());const first=saver.flush();assert.equal(first,saver.flush());
    saver.enqueue(page('vault-a','Newer draft'));
    completeFirst({...sent[0],revision:2});await first;
    assert.equal(sent.length,2);assert.equal(sent[0].title,'First draft');assert.equal(sent[1].title,'Newer draft');assert.equal(sent[1].revision,2);
    assert.equal(saved.at(-1).revision,3);assert.equal(saver.hasPending,false);assert.equal(statuses.at(-1),'saved');
  } finally {saver.dispose();}
});
test('a failed save retains the newer draft for retry', async () => {
  let rejectFirst,fail=true;const sent=[];
  const saver=new PageSaver(async snapshot=>{
    sent.push(structuredClone(snapshot));
    if(fail)return await new Promise((_,reject)=>{rejectFirst=reject;});
    return {...snapshot,revision:2};
  },()=>{},()=>{});
  try {
    saver.enqueue(page());const write=saver.flush();saver.enqueue(page('vault-a','Keep this draft'));
    rejectFirst(new Error('Connection lost'));await assert.rejects(write,/Connection lost/);assert.equal(saver.hasPending,true);
    fail=false;await saver.flush();assert.equal(sent.at(-1).title,'Keep this draft');assert.equal(sent.at(-1).revision,1);assert.equal(saver.hasPending,false);
  } finally {saver.dispose();}
});
test('identical page IDs from different vaults retain their original scope', async () => {
  const sent=[];const saver=new PageSaver(async snapshot=>{sent.push(snapshot);return {...snapshot,revision:2};},()=>{},()=>{});
  try {
    saver.enqueue(page('vault-a'));saver.enqueue(page('vault-b'));await saver.flush();
    assert.deepEqual(sent.map(p=>p.vault_id),['vault-a','vault-b']);assert.equal(saver.hasPending,false);
  } finally {saver.dispose();}
});

test('save preparation reports identification before saving and preserves the original snapshot', async () => {
  const statuses = [], savedPairs = [], sent = [];
  const original = {...page(), blocks: [{id:'text', type:'paragraph', content:[{text:'Ada'}]}]};
  const saver = new PageSaver(async snapshot => { sent.push(snapshot); return {...snapshot, revision: 2}; },
    (saved, before) => savedPairs.push([saved, before]), status => statuses.push(status),
    async snapshot => ({...snapshot, blocks: [{...snapshot.blocks[0], content: [{entityId: 'ada'}]}]}));
  try {
    saver.enqueue(original); await saver.flush();
    assert.deepEqual(statuses, ['pending', 'identifying', 'saving', 'saved']);
    assert.deepEqual(sent[0].blocks[0].content, [{entityId:'ada'}]);
    assert.deepEqual(savedPairs[0][1].blocks[0].content, [{text:'Ada'}]);
    assert.equal(saver.hasPending, false);
  } finally { saver.dispose(); }
});

test('edits during identification invalidate stale preparation before a write', async () => {
  let complete;
  const sent = [];
  let prepared = 0;
  const saver = new PageSaver(async snapshot => { sent.push(snapshot); return {...snapshot, revision:2}; }, () => {}, () => {}, async snapshot => {
    if (++prepared === 1) await new Promise(resolve => { complete = resolve; });
    return snapshot;
  });
  try {
    saver.enqueue(page()); const writing = saver.flush();
    saver.enqueue(page('vault-a', 'Latest draft'));
    complete(); await writing;
    assert.equal(prepared, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'Latest draft');
    assert.equal(saver.hasPending, false);
  } finally { saver.dispose(); }
});

test('failed preparation retains edits for retry', async () => {
  let fail = true;
  const sent = [], statuses = [];
  const saver = new PageSaver(async snapshot => { sent.push(snapshot); return {...snapshot,revision:2}; }, () => {}, status => statuses.push(status), async snapshot => {
    if (fail) throw new Error('Identification failed');
    return snapshot;
  });
  try {
    saver.enqueue(page()); await assert.rejects(saver.flush(), /Identification failed/);
    assert.equal(saver.hasPending, true);
    assert.equal(sent.length, 0);
    fail = false; await saver.flush();
    assert.equal(sent.length, 1);
    assert.equal(statuses.at(-1), 'saved');
  } finally { saver.dispose(); }
});
