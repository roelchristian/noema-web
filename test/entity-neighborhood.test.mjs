import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {entityNeighborhood,NEIGHBORHOOD_NODE_LIMIT,NEIGHBORHOOD_EDGE_LIMIT} from '../src/server/modules/entity-neighborhood.ts';
function fixture(t){
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),vaults=new Vaults(store),vault=vaults.create({name:'Graph'}).id;
 t.after(()=>db.close());
 const create=(name)=>knowledge.create(vault,{name,type:'concept'});
 const relation=(id,source,target,label='knows')=>store.run('INSERT INTO relationships (id,source_id,target_id,label) VALUES (?,?,?,?)',id,source.id,target.id,label);
 return {store,knowledge,vaults,vault,create,relation,read:(root,depth=1,relationType)=>entityNeighborhood(store,vault,root.id,{depth,relationType})};
}
test('neighborhood preserves directed identities, incoming properties, cycles, archived entities and two hops',t=>{
 const f=fixture(t),a=f.create('A'),b=f.create('B'),c=f.create('C');
 f.relation('same',a,b);f.relation('reverse',b,a,'returns');f.relation('second',b,c);f.relation('cycle',c,c,'self');
 f.store.run('INSERT INTO properties (id,entity_id,name,target_id) VALUES (?,?,?,?)','same',b.id,'References',a.id);
 f.store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-22',b.id);
 const first=f.read(a);assert.equal(first.nodes.length,2);assert.equal(first.edges.length,3);
 assert.deepEqual(new Set(first.edges.map(edge=>edge.id)),new Set(['relationship:same','relationship:reverse','property:same']));
 const property=first.edges.find(edge=>edge.kind==='property');assert.equal(property.sourceId,b.id);assert.equal(property.targetId,a.id);
 assert.equal(first.nodes.find(node=>node.id===b.id).archived_at,'2026-10-22');
 const second=f.read(a,2);assert.equal(second.nodes.length,3);assert.equal(second.edges.length,4);assert.equal(second.truncated,false);
 // A self-edge on a node exactly two hops away is outside a two-hop expansion.
 assert.ok(!second.edges.some(edge=>edge.id==='relationship:cycle'));
});
test('relationship filter keeps properties, respects direction and prevents disconnected filtered hops',t=>{
 const f=fixture(t),a=f.create('A'),b=f.create('B'),c=f.create('C'),d=f.create('D');
 f.relation('first',a,b,'knows');f.relation('second',b,c,'visits');f.relation('excluded',a,d,'visits');
 f.store.run('INSERT INTO properties (id,entity_id,name,target_id) VALUES (?,?,?,?)','p',c.id,'References',a.id);
 const result=f.read(a,2,'knows');
 assert.deepEqual(result.relationTypes,['knows','visits']);assert.equal(result.edges.length,2);
 assert.deepEqual(new Set(result.nodes.map(node=>node.id)),new Set([a.id,b.id,c.id]));
 assert.ok(!result.nodes.some(node=>node.id===d.id));
});
test('neighborhood validates open vault and root ownership and excludes forged cross-vault edges',t=>{
 const f=fixture(t),a=f.create('A'),other=f.vaults.create({name:'Other'}).id,b=f.knowledge.create(other,{name:'B',type:'concept'});
 f.relation('forged',a,b);assert.equal(f.read(a).edges.length,0);
 assert.throws(()=>f.read(b),/not found/);assert.throws(()=>f.read(a,3),/one or two hops/);
 f.vaults.lock(f.vault,{passphrase:'locked'});assert.throws(()=>f.read(a),/locked/);
});
test('dense neighborhoods are deterministic, bounded and contain no dangling edges',t=>{
 const f=fixture(t),root=f.create('Root');
 for(let i=0;i<80;i++){const node=f.create(`Node ${String(i).padStart(3,'0')}`);f.relation(`edge-${i}`,root,node);}
 const first=f.read(root,2),second=f.read(root,2);
 assert.deepEqual(first,second);assert.equal(first.truncated,true);assert.equal(first.nodes.length,NEIGHBORHOOD_NODE_LIMIT);
 assert.ok(first.edges.length<=NEIGHBORHOOD_EDGE_LIMIT);
 const ids=new Set(first.nodes.map(node=>node.id));assert.ok(first.edges.every(edge=>ids.has(edge.sourceId)&&ids.has(edge.targetId)));
});
test('many distinct edges between the same nodes are capped without collapsing identity',t=>{
 const f=fixture(t),a=f.create('A'),b=f.create('B');for(let i=0;i<260;i++)f.relation(`edge-${i}`,a,b,`label-${i}`);
 const result=f.read(a);assert.equal(result.nodes.length,2);assert.equal(result.edges.length,NEIGHBORHOOD_EDGE_LIMIT);assert.equal(result.truncated,true);
 assert.equal(new Set(result.edges.map(edge=>edge.id)).size,NEIGHBORHOOD_EDGE_LIMIT);
});
