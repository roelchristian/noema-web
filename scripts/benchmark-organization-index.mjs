// Synthetic algorithm benchmark; this does not estimate device rendering performance.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {organizationIndex} from '../src/client/organization/organization-index.ts';
const results=[];
for(const size of [1000,10000]) {
 const pages=Array.from({length:size},(_,i)=>({id:'p'+i,title:'Synthetic '+i,updated_at:'2026-10-27'}));
 const data={collections:[{id:'c',name:'Synthetic collection'}],folders:Array.from({length:100},(_,i)=>({id:'f'+i,name:'Synthetic folder '+i,parent_id:i?'f0':null})),folderLinks:[],locations:pages.map((page,i)=>({kind:'page',item_id:page.id,folder_id:'f'+i%100})),memberships:pages.map(page=>({kind:'page',item_id:page.id,collection_id:'c'})),favourites:pages.filter((_,i)=>i%2===0).map(page=>({kind:'page',item_id:page.id}))};
 let start=performance.now(),baseline=0;
 for(const page of pages) {
  baseline+=Number(data.favourites.some(row=>row.kind==='page'&&row.item_id===page.id));
  baseline+=Number(!!data.locations.find(row=>row.kind==='page'&&row.item_id===page.id));
  baseline+=Number(data.memberships.some(row=>row.kind==='page'&&row.item_id===page.id&&row.collection_id==='c'));
 }
 const scanMs=performance.now()-start;
 start=performance.now();const index=organizationIndex(data,pages),buildMs=performance.now()-start;
 start=performance.now();let indexed=0;
 for(const page of pages) {
  indexed+=Number(index.favourites.has('page:'+page.id));indexed+=Number(index.locations.has('page:'+page.id));indexed+=Number(index.collectionItems.get('c').has('page:'+page.id));
 }
 const lookupMs=performance.now()-start;assert.equal(indexed,baseline);
 results.push({pages:size,scanMs,indexBuildMs:buildMs,indexLookupMs:lookupMs,matched:baseline,fullSnapshotBytes:Buffer.byteLength(JSON.stringify(data)),oldBulk50SnapshotBytes:50*Buffer.byteLength(JSON.stringify(data)),newBulk50SnapshotBytes:Buffer.byteLength(JSON.stringify(data)),oldBulk50Requests:50,newBulk50Requests:1});
}
console.log(JSON.stringify({kind:'synthetic algorithm and serialized snapshot measurements',runtime:process.version,results,limits:'No browser rendering or representative device timing. All rows still render; no windowing introduced without rendering evidence.'},null,2));
