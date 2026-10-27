// Synthetic-only. Run with SAVE_COST_ROOT pointing at a baseline checkout for comparison.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.SAVE_COST_ROOT??process.cwd();
const load=p=>import(pathToFileURL(path.join(root,p)).href);
const [{openDatabase},{Store},{Knowledge},{Pages},{Images}]=await Promise.all(['src/server/database.ts','src/server/store.ts','src/server/modules/knowledge.ts','src/server/modules/pages.ts','src/server/modules/images.ts'].map(load));
const dir=mkdtempSync(path.join(tmpdir(),'noema-save-bench-')),db=openDatabase(path.join(dir,'db.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),images=new Images(store);
try {
 const entity=knowledge.create('default',{name:'Synthetic entity',type:'concept'}),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64'),image=images.add('default',png);
 let page=pages.create('default',{title:'Synthetic long document'});
 const blocks=Array.from({length:1000},(_,i)=>({id:String(i),type:'paragraph',content:[{text:'Synthetic paragraph '.repeat(10)},{entityId:entity.id},{entityId:entity.id}]}));
 blocks.push({id:'image',type:'image',content:[],imageId:image.id});page=pages.update('default',page.id,{...page,blocks});
 for(let i=0;i<50;i++)pages.create('default',{title:'Synthetic unrelated '+i});
 const counts={cleanupCalls:0,vaultBodyScanQueries:0,vaultBodiesScanned:0,entityQueries:0,historyInserts:0,historyBytesWritten:0,sqlCalls:0};
 const cleanup=Images.prototype.cleanup;Images.prototype.cleanup=function(...args){counts.cleanupCalls++;return cleanup.apply(this,args);};
 for(const method of ['get','all','run']){const original=store[method].bind(store);store[method]=function(sql,...args){counts.sqlCalls++;if(sql.includes('FROM entities')&&(sql.includes('id=?')||sql.includes('e.id=?')))counts.entityQueries++;const result=original(sql,...args);if(sql.startsWith('SELECT blocks,featured_image_id FROM pages')){counts.vaultBodyScanQueries++;counts.vaultBodiesScanned+=result.length;}if(sql.startsWith('INSERT INTO page_versions ')){counts.historyInserts++;counts.historyBytesWritten+=Buffer.byteLength(args[9]);}return result;};}
 const start=performance.now();
 for(let i=0;i<5;i++)page=pages.update('default',page.id,{...page,blocks:page.blocks.map((b,index)=>index?b:{...b,content:[{text:'Changed '+i},...b.content.slice(1)]})});
 const changedBytes=5*Buffer.byteLength('Changed 0');
 console.log(JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch},fixture:{blocks:1001,unrelatedNotes:50,edits:5},...counts,elapsedMs:performance.now()-start,changedBytes,historyWriteAmplification:counts.historyBytesWritten/changedBytes,historyStorage:store.get('SELECT count(*) AS versions,sum(length(snapshot_json)) AS snapshotBytes FROM page_versions WHERE page_id=?',page.id),note:'Synthetic local server CPU/storage measurement; not device UX performance.'},null,2));
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
