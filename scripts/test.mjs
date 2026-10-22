import {readdir,readFile} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

export async function discoverTestFiles(directory) {
  const entries=await readdir(directory,{withFileTypes:true});
  return (await Promise.all(entries.map(entry=>entry.isDirectory()?discoverTestFiles(join(directory,entry.name)):entry.isFile()&&entry.name.endsWith('.test.mjs')?[join(directory,entry.name)]:[]))).flat().sort();
}
export function selectTests(files,groups,group='all') {
  const listed=Object.values(groups).flat(),discovered=new Set(files);
  if(new Set(listed).size!==listed.length)throw new Error('Duplicate test group entries');
  const missing=files.filter(file=>!listed.includes(file)),obsolete=listed.filter(file=>!discovered.has(file));
  if(missing.length||obsolete.length)throw new Error(`Update test/groups.json. Ungrouped: ${missing.join(', ')}; absent: ${obsolete.join(', ')}`);
  if(group!=='all'&&!Object.hasOwn(groups,group))throw new Error(`Unknown test group: ${group}`);
  return group==='all'?files:groups[group];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const root=resolve(import.meta.dirname,'..');
  const files=(await discoverTestFiles(join(root,'test'))).map(file=>relative(root,file));
  const groups=JSON.parse(await readFile(join(root,'test/groups.json'),'utf8'));
  const group=process.argv.find(arg=>arg.startsWith('--group='))?.split('=')[1]??'all';
  const selected=selectTests(files,groups,group);
  if(process.argv.includes('--list'))console.log(JSON.stringify({group,files:selected,count:selected.length},null,2));
  else {
    const result=spawnSync(process.execPath,['--import','tsx','--test','--test-reporter=tap',...selected],{cwd:root,stdio:'inherit'});
    if(result.error)throw result.error;
    process.exitCode=result.status??1;
  }
}
