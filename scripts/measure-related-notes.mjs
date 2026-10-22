// Disposable source instrumentation; synthetic responses, no provider or real vault.
import {mkdtemp,cp,readFile,writeFile,symlink,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const repo=resolve(import.meta.dirname,'..'),baseline=process.argv[2]??'origin/main';
for(const version of ['before','after']){
 const directory=await mkdtemp(join(tmpdir(),'noema-related-measure-'));
 try{
  await cp(join(repo,'src'),join(directory,'src'),{recursive:true});await mkdir(join(directory,'test'),{recursive:true});await cp(join(repo,'test/helpers'),join(directory,'test/helpers'),{recursive:true});
  for(const path of ['package.json','tsconfig.json'])await cp(join(repo,path),join(directory,path));await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
  for(const path of ['src/client/intelligence/RelatedNotes.tsx','src/client/intelligence/suggestion-refresh.ts']){
   let source=version==='before'?execFileSync('git',['show',`${baseline}:${path}`],{cwd:repo,encoding:'utf8'}):await readFile(join(repo,path),'utf8');
   if(path.endsWith('RelatedNotes.tsx')){
    if(version==='before')source=source.replace('setNotes(items);',`setNotes(previous=>{if(previous!==items)(globalThis as any).__relatedMetrics.commits++;return items;});`).replace('notes.map(note=>',`((globalThis as any).__relatedMetrics.lists++,notes).map(note=>`);
    else source=source.replace('return <ul className=',`(globalThis as any).__relatedMetrics.lists++;\n  return <ul className=`).replace('return sameRelatedNotes(previous,next)?previous:next;',`if(!sameRelatedNotes(previous,next))(globalThis as any).__relatedMetrics.commits++;\n          return sameRelatedNotes(previous,next)?previous:next;`);
   }
   await writeFile(join(directory,path),source);
  }
  await writeFile(join(directory,'fixture.mjs'),`
import React,{act} from 'react';import {createRoot} from 'react-dom/client';
import {setupDOM} from './test/helpers/dom.mjs';import {api} from './src/client/api.ts';import {RelatedNotes} from './src/client/intelligence/RelatedNotes.tsx';
const env=setupDOM();globalThis.__relatedMetrics={commits:0,lists:0};let calls=0,versions=0,version=1,editorRenders=0;
let page={id:'synthetic',vault_id:'fixture',revision:1};const items=[{pageId:'related',title:'Synthetic',excerpt:'Synthetic evidence',score:1}];
api.suggestionVersion=async()=>{versions++;return {version:String(version)}};api.relatedNotes=async()=>{calls++;return structuredClone(items)};api.relatedNotesState=async()=>{calls++;return {notes:structuredClone(items),pending:false,retainedPageIds:['related']}};
const root=createRoot(document.querySelector('#mount')),open=()=>{};function Editor(){editorRenders++;return React.createElement('textarea',{defaultValue:'Synthetic editor'})}const editor=React.createElement(Editor);
async function render(){await act(async()=>root.render(React.createElement(React.Fragment,null,editor,React.createElement(RelatedNotes,{page,onOpenPage:id=>open(id)}))))}async function settle(){await act(async()=>new Promise(resolve=>setTimeout(resolve,430)))}
await render();await settle();const initial={calls,versions,...__relatedMetrics,editorRenders};
for(let i=0;i<3;i++){page={...page,revision:page.revision+1};await render();await settle()}
const revisionHints={calls:calls-initial.calls,versions:versions-initial.versions,commits:__relatedMetrics.commits-initial.commits,lists:__relatedMetrics.lists-initial.lists,editorRenders:editorRenders-initial.editorRenders};
const start={calls,versions,...__relatedMetrics,editorRenders};for(let i=0;i<3;i++){version++;await act(async()=>document.dispatchEvent(new Event('visibilitychange')))}
const unchangedRefreshes={calls:calls-start.calls,versions:versions-start.versions,commits:__relatedMetrics.commits-start.commits,lists:__relatedMetrics.lists-start.lists,editorRenders:editorRenders-start.editorRenders};
console.log(JSON.stringify({initial,revisionHints,unchangedRefreshes}));await act(async()=>root.unmount());await env.close();
`);
  console.log(version,execFileSync(process.execPath,['--import','tsx','fixture.mjs'],{cwd:directory,encoding:'utf8'}).trim());
 }finally{await rm(directory,{recursive:true,force:true});}
}
