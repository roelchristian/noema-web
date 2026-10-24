import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBibliography,exportBibliography,exportOriginalBibliography,normalizeDoi} from '../src/shared/bibliography.ts';

test('bibliography preserves complete originals and round-trips macros, TeX, names, dates and extensions',()=>{
 const raw=String.raw`% Archive comment
@string{publisher = {Synthetic Press}}
@preamble{"one"}
@preamble{"two"}
@book{parent, title={A {Protected} Title}, publisher=publisher, year={-0044}}
@inbook{child, crossref={parent}, author={Garc{\'i}a, Ana and {Synthetic Research Group}}, translator={Doe, Jane}, custom-x={unrecognised {nested} data}, origdate={1750/1755}}
@oddtype{unknown,title={Unknown work},custom={retained}}
`;
 const parsed=parseBibliography(raw);
 assert.equal(parsed.entries.length,3);
 const child=parsed.entries[1];
 assert.equal(child.fields.publisher,'Synthetic Press');
 assert.equal(child.fields.year,'-0044');
 assert.equal(child.fields.booktitle,'A {Protected} Title');
 assert.equal(parsed.entries[2].entryType,'oddtype');
 assert.equal(child.fields['custom-x'],'unrecognised {nested} data');
 assert.deepEqual(child.creators.filter(p=>p.role==='author').map(p=>(p.literal||p.family).normalize('NFC')),['García','Synthetic Research Group']);
 assert.equal(exportOriginalBibliography(parsed.entries),raw);
 const exported=exportBibliography(parsed.entries);
 const again=parseBibliography(exported);
 assert.equal(exportBibliography(again.entries),exported);
 assert.deepEqual(again.entries.map(({citationKey,entryType,fields})=>({citationKey,entryType,fields})),[...parsed.entries].sort((a,b)=>a.citationKey.localeCompare(b.citationKey)).map(({citationKey,entryType,fields})=>({citationKey,entryType,fields})));
});
test('malformed bibliography cannot silently produce a partial import',()=>{
 assert.throws(()=>parseBibliography('@book{a,crossref={b}}@book{b,crossref={a}}'),/Circular cross-reference/);
 assert.throws(()=>parseBibliography('@book{k,title={A}}@book{k,title={B}}'),/Duplicate citation keys/);
 assert.throws(()=>parseBibliography('@book{ok,title={Good}}\n@book{bad,title={broken}'),/./);
 const entry=parseBibliography('@book{key,title={Good}}').entries[0];
 assert.throws(()=>exportBibliography([{...entry,fields:{title:'ends'+String.fromCharCode(92)}}]),/backslash/);
 assert.throws(()=>exportBibliography([{...entry,fields:{title:'bad} @book{injected'}}]),/braces/);
});
test('DOI normalization is exact and preserves meaningful suffix punctuation',()=>{
 assert.equal(normalizeDoi(' HTTPS://doi.org/10.1234/ABC(2) '),'10.1234/abc(2)');
 assert.equal(normalizeDoi('doi:10.1234/ABC'),'10.1234/abc');
 assert.equal(normalizeDoi('10.1/no'),undefined);
 assert.equal(normalizeDoi('10.1234/has space'),undefined);
});
