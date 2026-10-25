import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
async function files(directory){const entries=await readdir(directory,{withFileTypes:true});return (await Promise.all(entries.map(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]))).flat();}
test('product tagline uses An atlas of thought throughout intended surfaces',async()=>{
 const surfaces=['index.html','README.md',...(await files(fileURLToPath(new URL('../src/client',import.meta.url)))),...(await files(fileURLToPath(new URL('../public',import.meta.url)))),...(await files(fileURLToPath(new URL('../docs',import.meta.url))))].filter(file=>/\.(?:html|md|tsx?|json|webmanifest|css)$/.test(file));
 for(const file of surfaces){const contents=await readFile(path.isAbsolute(file)?file:new URL(file,root),'utf8');assert.doesNotMatch(contents,/local[\s-]+knowledge[\s-]+(?:workspace|worspace|work\s+space)/i,file);}
 assert.match(await readFile(new URL('index.html',root),'utf8'),/<title>Noema · An atlas of thought<\/title>/);
 assert.match(await readFile(new URL('README.md',root),'utf8'),/^An atlas of thought\./m);
});
