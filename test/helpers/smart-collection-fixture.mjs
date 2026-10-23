import {openDatabase} from '../../src/server/database.ts';
import {Store} from '../../src/server/store.ts';
import {Organizer} from '../../src/server/modules/organization.ts';
import {Vaults} from '../../src/server/modules/vaults.ts';
import {SemanticCollections} from '../../src/server/modules/semantic-collections.ts';
import {evaluateSemanticBatch} from '../../src/server/modules/smart-semantic-scoring.ts';
import {embeddingModel,embeddingDimensions} from '../../src/shared/embeddings.ts';
export const semanticConfig=patch=>({version:1,description:'Substantial discussion of algebra',threshold:.55,minCoverage:.5,...patch});
export const semanticVector=(score=1)=>Array.from({length:embeddingDimensions},(_,index)=>index===0?score:index===1?Math.sqrt(1-score*score):0);
const config=semanticConfig,vector=semanticVector;
export function semanticFixture(t){
 const db=openDatabase(':memory:'),store=new Store(db),org=new Organizer(store),vaults=new Vaults(store),vault=vaults.create({name:'Synthetic semantic vault'}).id,semantic=new SemanticCollections(store);
 t.after(()=>db.close());
 function page(id,scores=[1],options={}){
  store.run("INSERT INTO pages(id,title,blocks,updated_at,created_at,vault_id,revision) VALUES(?,?,'[]','2026-10-23','2026-10-23',?,1)",id,id,vault);
  const projection='projection-'+id;
  store.run("INSERT INTO page_index_state(page_id,vault_id,revision,projection_hash,strategy,policy_hash,token_count,updated_at,body_characters) VALUES(?,?,1,?,'passages','synthetic-policy',?,'2026-10-23',?)",id,vault,projection,scores.length*100,scores.length*100);
  store.run('DELETE FROM page_index_dirty WHERE page_id=?',id);
  for(const [index,score] of scores.entries()){
   const segment=id+'-segment-'+index,hash='hash-'+segment,start=options.overlap?index*10:index*100,end=start+100;
   store.run("INSERT INTO page_segments VALUES(?,?,?,1,?,?,?,'Synthetic passage evidence','Synthetic input',?,'[]',?,?,100)",segment,id,vault,projection,index,'Section '+index,hash,start,end);
   if(score!==null)store.run('INSERT INTO page_segment_embeddings VALUES(?,?,?,?,?,100,?)',segment,embeddingModel,embeddingDimensions,hash,JSON.stringify(vector(score)),'2026-10-23');
  }
  return id;
 }
 const score=(id,patch={},collection)=>evaluateSemanticBatch(store,vault,config(patch),vector(),'',100,[id],collection).items[0];
 const settle=async id=>{for(let index=0;index<100;index++){org.list(vault);await new Promise(resolve=>setTimeout(resolve,10));const collection=org.list(vault).collections.find(item=>item.id===id);if(['ready','partial','error'].includes(collection?.smart?.status))return collection;}throw Error('Semantic collection did not settle');};
 return {db,store,org,vaults,vault,semantic,page,score,settle};
}
