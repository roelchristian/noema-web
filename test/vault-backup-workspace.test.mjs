import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '../src/client/state/workspace.ts';
import {api} from '../src/client/api.ts';

test('export flushes pending edits before downloading and failed saves prevent export',async context=>{
  const vault={id:'source',name:'Source',locked:false},events=[];
  context.mock.method(api,'vaults',async()=>[vault]);
  context.mock.method(api,'archivedPages',async()=>[]);context.mock.method(api,'pages',async()=>[]);context.mock.method(api,'entities',async()=>[]);
  context.mock.method(api,'organization',async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]}));
  const workspace=new Workspace();
  try {
    await workspace.selectVault(vault.id);
    const flush=context.mock.method(workspace.saver,'flush',async()=>{events.push('flush');return null;});
    context.mock.method(api,'exportVault',async id=>{events.push('download:'+id);return {blob:new Blob(['backup']),filename:'Source.noemabkp'};});
    const result=await workspace.exportVault();assert.equal(result.filename,'Source.noemabkp');assert.deepEqual(events,['flush','download:source']);
    flush.mock.mockImplementation(async()=>{throw new Error('Save failed');});
    await assert.rejects(workspace.exportVault(),/Save failed/);assert.equal(api.exportVault.mock.callCount(),1);
  } finally {workspace.saver.dispose();workspace.titler.dispose();}
});
test('import flushes pending edits and opens the new vault only after successful restoration',async context=>{
  const events=[],workspace=new Workspace(),file=new File(['backup'],'test.noemabkp');
  context.mock.method(workspace.saver,'flush',async()=>{events.push('flush');return null;});
  const restore=context.mock.method(api,'importVault',async(received,name)=>{assert.equal(received,file);assert.equal(name,'Restored');events.push('import');return {id:'new-vault'};});
  context.mock.method(workspace,'selectVault',async id=>events.push('open:'+id));
  try {
    await workspace.importVault(file,'Restored');assert.deepEqual(events,['flush','import','open:new-vault']);
    restore.mock.mockImplementation(async()=>{throw new Error('Damaged backup');});
    await assert.rejects(workspace.importVault(file),/Damaged backup/);assert.equal(workspace.selectVault.mock.callCount(),1);
  } finally {workspace.saver.dispose();workspace.titler.dispose();}
});
