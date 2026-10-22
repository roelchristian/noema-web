// Instrument disposable copies; production sources contain no counters. No timing claims.
import {mkdtemp,cp,readFile,writeFile,symlink,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const repo=resolve(import.meta.dirname,'..');
const baseline=process.argv[2]??'origin/main';
for(const version of ['before','after']) {
  const directory=await mkdtemp(join(tmpdir(),'noema-editor-measure-'));
  try {
    await cp(join(repo,'src'),join(directory,'src'),{recursive:true});
    await mkdir(join(directory,'test/fixtures'),{recursive:true});
    await cp(join(repo,'test/helpers'),join(directory,'test/helpers'),{recursive:true});
    await cp(join(repo,'test/fixtures/editor-rendering.mjs'),join(directory,'test/fixtures/editor-rendering.mjs'));
    await cp(join(repo,'package.json'),join(directory,'package.json'));await cp(join(repo,'tsconfig.json'),join(directory,'tsconfig.json'));
    await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
    const paths=['src/client/editor/BlockEditor.tsx','src/client/editor/segments.tsx','src/client/editor/preserve-caret.ts'];
    for(const path of paths) {
      let source=version==='before'?execFileSync('git',['show',`${baseline}:${path}`],{cwd:repo,encoding:'utf8'}):await readFile(join(repo,path),'utf8');
      const instrument=(needle,replacement)=>{assertOnce(source,needle);source=source.replace(needle,replacement);};
      if(path.endsWith('BlockEditor.tsx')) {
        if(version==='before')instrument('const renderBlock = (block: Block) =>','const renderBlock = (block: Block) => ((globalThis as any).__editorMetrics?.rows.push(block.id), renderMeasuredBlock(block));\n  const renderMeasuredBlock = (block: Block) =>');
        else instrument('  const register=useCallback((element:HTMLElement|null)=>actions.register','  (globalThis as any).__editorMetrics?.rows.push(block.id);\n  const register=useCallback((element:HTMLElement|null)=>actions.register');
      } else if(path.endsWith('segments.tsx'))instrument('  const changed = !segmentsEqual','  (globalThis as any).__editorMetrics?.syncs.push(location.blockId);\n  const changed = !segmentsEqual');
      else instrument('export function replaceEditableHTML(element: HTMLElement, html: string) {','export function replaceEditableHTML(element: HTMLElement, html: string) {\n  (globalThis as any).__editorMetrics?.replacements.push(element.closest<HTMLElement>(\'[data-block-id]\')?.dataset.blockId);');
      await writeFile(join(directory,path),source);
    }
    for(const history of ['0','1'])console.log(version,history==='1'?'history':'direct',execFileSync(process.execPath,['--import','tsx','test/fixtures/editor-rendering.mjs'],{cwd:directory,env:{...process.env,MEASURE_EDITOR:'1',MEASURE_HISTORY:history,EXPECT_ISOLATION:version==='after'?'1':'0'},encoding:'utf8'}).trim());
  } finally {await rm(directory,{recursive:true,force:true});}
}
function assertOnce(source,needle){if(source.split(needle).length!==2)throw Error(`Instrumentation anchor must occur once: ${needle}`);}
