import {randomUUID} from 'node:crypto';
import {openDatabase} from '../../src/server/database.ts';
import {Store} from '../../src/server/store.ts';
import {Pages} from '../../src/server/modules/pages.ts';
import {Knowledge} from '../../src/server/modules/knowledge.ts';
import {Vaults} from '../../src/server/modules/vaults.ts';
import {Embeddings} from '../../src/server/modules/embeddings.ts';
import {SourcePassages} from '../../src/server/modules/source-passages.ts';
import {ChatRetrieval} from '../../src/server/modules/chat-retrieval.ts';
export function chatCorpus() {
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),vaults=new Vaults(store);
 const other=vaults.create({name:'Private vault'}).id;
 const entity=(name,description='',vault='default')=>knowledge.create(vault,{name,type:'person',description});
 const note=(title,text,vault='default')=>{
  const page=pages.create(vault,{title});return pages.update(vault,page.id,{...page,blocks:[{id:randomUUID(),type:'paragraph',content:[{text}]}]});
 };
 const source=(name,text,vault='default')=>{
  const id=randomUUID(),fileId=randomUUID(),now=new Date().toISOString();
  store.run("INSERT INTO entities (id,name,type,description,updated_at,vault_id) VALUES (?,?,'source','',?,?)",id,name,now,vault);
  store.run("INSERT INTO source_files (id,vault_id,entity_id,name,size,status,text,created_at,format,admitted) VALUES (?,?,?,?,?,'ready',?,?,'md',1)",fileId,vault,id,name+'.md',Buffer.byteLength(text),text,now);
  new SourcePassages(store).synchronize(vault);return {id,fileId,name,text};
 };
 const augustine=entity('Augustine','The bishop of Hippo'),aquinas=entity('Aquinas','Scholastic philosopher'),ambiguous=entity('Augustine','A twentieth-century namesake');
 const myNote=note('My grace reflections','Grace is not entirely irresistible. My own note disagrees with the source claim about grace.');
 const unrelated=note('Unconnected grace note','Grace is merely ceremonial according to this unrelated page.');
 const hidden=note('Private secret grace','VAULT_SECRET_93 grace is private.',other);
 const primary=source('First grace treatise','# Grace\nAugustine teaches grace is irresistible. This source claim conflicts with a personal note.');
 const opposing=source('Second grace treatise','# Grace and choice\nAquinas describes grace as cooperating with human freedom.');
 store.run('INSERT INTO relationships (id,source_id,label,target_id) VALUES (?,?,?,?)','influenced',aquinas.id,'influenced by',augustine.id);
 store.run('INSERT INTO properties (id,entity_id,name,value) VALUES (?,?,?,?)','period',augustine.id,'Period','Late antiquity');
 store.run('INSERT INTO entity_overviews (entity_id,content,revision) VALUES (?,?,1)',augustine.id,'A curated overview of Augustine and grace.');
 store.run('INSERT INTO entity_page_associations (entity_id,page_id,created_at) VALUES (?,?,?)',augustine.id,myNote.id,new Date().toISOString());
 store.run('INSERT INTO relationships (id,source_id,label,target_id) VALUES (?,?,?,?)','source-for',augustine.id,'recorded in',primary.id);
 const embeddings=new Embeddings(store,pages,knowledge,vaults,{status:()=>({configured:false})});
 const retrieval=new ChatRetrieval(store,embeddings,vaults);
 return {db,store,pages,knowledge,vaults,other,entity,note,source,augustine,aquinas,ambiguous,myNote,unrelated,hidden,primary,opposing,embeddings,retrieval,close(){embeddings.close();db.close();}};
}
