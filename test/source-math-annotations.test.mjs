import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceMathAnnotations} from '../src/shared/source-math-annotations.ts';
import {sourceIngestionRepairFindings} from '../src/server/modules/source-ingestion-validation.ts';

test('formula spans preserve decoded UTF-16 coordinates and all source punctuation',()=>{
 const text=String.raw`😀 Printed $G_{a.b}$, then $\overline{H}$ and $H'$.`;
 const a=sourceMathAnnotations(text);assert.equal(a.formulas.length,3);assert.equal(a.formulas[0].start,text.indexOf('$'));
 assert.equal(a.formulas[0].source,'G_{a.b}');assert.equal(a.formulas[1].decoratedIdentifiers[0].decoration,'overline');assert.equal(a.formulas[2].decoratedIdentifiers[0].base,'H');
 for(const f of a.formulas)assert.equal(text.slice(f.start,f.end).slice(1,-1),f.source);
 assert.equal(a.verified,false);assert.equal(text.includes('G_{a.b}'),true);
});
test('piecewise equations retain each boundary condition and nested alignments',()=>{
 const text=String.raw`$$C=\begin{cases}1&d=0\\p^{d-1}+p^d&1\le d\le a\\\begin{matrix}x&y\\z&w\end{matrix}&a+1\le d\le b\\0&b<d\end{cases}\tag{1}$$`;
 const [f]=sourceMathAnnotations(text).formulas;assert.equal(f.syntax,'valid');assert.equal(f.equationLabel,'1');assert.equal(f.cases.length,4);
 assert.deepEqual(f.cases.map(c=>c.condition),['d=0',String.raw`1\le d\le a`,String.raw`a+1\le d\le b`,'b<d']);
 assert.match(f.cases[2].value,/matrix/);
});
test('a source set-variable mismatch is reviewable without rewriting the formula',()=>{
 const source=String.raw`$$\{H : |\overline{H}|=p^{d-2}\}$$`;
 const a=sourceMathAnnotations(source);assert.equal(a.formulas[0].syntax,'valid');assert.ok(a.review.some(r=>r.kind==='notation-review'));assert.match(a.review[0].reason,/may be intentional/);
 assert.equal(a.formulas[0].source,source.slice(2,-2));
 const faithful=sourceMathAnnotations(String.raw`$$\{\overline{H} : |\overline{H}|=p^{d-2}\}$$`);assert.equal(faithful.review.length,0);
});
test('code, escaped currency and ordinary prices are not mathematical annotations',()=>{
 const a=sourceMathAnnotations('`$H$` costs \\$5 and $12.00. Real $H$ here.');assert.equal(a.formulas.length,1);assert.equal(a.formulas[0].source,'H');assert.equal(a.review.length,0);
});
test('syntax success does not conceal unreadable placeholders',()=>{
 const text='$x=\\text{[unreadable sign]}4$';const a=sourceMathAnnotations(text);assert.equal(a.formulas[0].syntax,'valid');assert.ok(a.review.some(r=>r.kind==='unreadable'));
 const b=sourceMathAnnotations('$\\notARealCommand{x}$');assert.equal(b.formulas[0].syntax,'invalid');assert.ok(b.review.some(r=>r.kind==='syntax'));
});
test('syntax annotation is bounded without discarding large formulas',()=>{
 const text='$$'+'x'.repeat(16001)+'$$';const a=sourceMathAnnotations(text);assert.equal(a.formulas[0].syntax,'not-checked');assert.equal(a.formulas[0].source.length,16001);assert.ok(a.review.some(r=>r.kind==='limit'));
});
test('unmarked notation becomes an advisory math finding, layout warnings do not',()=>{
 const b={id:'b',page:1,order:0,kind:'paragraph',text:'An order p^{d-2} appears.',headingLevel:null,continues:null,table:null,location:null,uncertainty:null,layoutWarnings:['Geometry omitted.']};
 const d={schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[]},pages:[{number:1,printedLabel:null,role:'owned',state:'content',unresolved:[]}],blocks:[b],relations:[],repairs:[]};
 const f=sourceIngestionRepairFindings(d);assert.ok(f.some(x=>x.kind==='math-review'));assert.ok(f.every(x=>x.independentVerification===false));
 d.blocks[0].text='Plain prose.';assert.deepEqual(sourceIngestionRepairFindings(d),[]);
});

test('derived reading annotations rebuild old assembly without changing source identity or coordinates',async()=>{
 const {assembleSourceIngestionDocument}=await import('../src/server/modules/source-ingestion-assembly.ts');
 const {resolveSourceDocument}=await import('../src/server/modules/source-ingestion-document.ts');
 const {sourceDocumentEntries}=await import('../src/shared/source-document.ts');
 const block=(id,order,text,kind='proof')=>({id,page:1,order,text,kind,headingLevel:null,continues:null,table:null,location:null,uncertainty:null});
 const figure={...block('f',1,'L connected to K','figure'),diagram:{nodes:[{id:'L',label:'L',quote:'L'},{id:'K',label:'K',quote:'K'}],edges:[{from:'L',to:'K',direction:'undirected',label:null,quote:null}],uncertainty:null},layoutWarnings:['Approximate placement.']};
 const document={schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[]},pages:[{number:1,printedLabel:null,role:'owned',state:'content',unresolved:[]}],blocks:[block('p',0,String.raw`Formula $\bar{H}$ is printed.`),figure],relations:[],repairs:[]};
 const assembly=assembleSourceIngestionDocument(document,{extractionId:'old'}),snapshot=JSON.stringify(assembly);
 const row={id:'old',content_hash:assembly.contentHash,assembly_version:1,assembly_json:snapshot,provenance_json:'{}'};
 const store={get:()=>row,all:()=>[]};
 const file={id:'source',vault_id:'v',name:'Old source',text:assembly.text,format:'pdf',pages:1,structural_nodes:JSON.stringify(assembly.structuralNodes),page_start_lines:'[1]',enrichment_status:'completed',language:null};
 const result=resolveSourceDocument(store,file),leaves=sourceDocumentEntries(result).filter(x=>x.node.text!==undefined).map(x=>x.node);
 assert.equal(leaves[0].id,assembly.semanticNodes[0].id);assert.deepEqual(leaves[0].range,assembly.semanticNodes[0].range);assert.equal(leaves[0].ingestion.math.formulas[0].source,String.raw`\bar{H}`);
 assert.deepEqual(leaves[1].ingestion.diagram,figure.diagram);assert.equal(leaves[1].ingestion.figureEvidence.physicalPage,1);assert.equal(leaves[1].ingestion.figureEvidence.representation,'original-page-image');assert.deepEqual(leaves[1].ingestion.layoutWarnings,figure.layoutWarnings);
 assert.equal(result.ingestion.contentHash,assembly.contentHash);assert.equal(JSON.stringify(assembly),snapshot);
});

test('large code-span scans stop with an explicit budget finding before allocating unbounded ranges',()=>{
 const text='`x` '.repeat(6000)+'$H$';const a=sourceMathAnnotations(text);
 assert.equal(a.formulas.length,0);assert.ok(a.review.some(issue=>issue.kind==='limit'&&/scan budget/.test(issue.reason)));assert.ok(a.review.length<=256);assert.equal(text.endsWith('$H$'),true);
});
test('large placeholder and unmarked-notation streams cap review allocation and disclose truncation',()=>{
 for(const text of ['[unreadable sign] '.repeat(20000),'p^{d} '.repeat(20000)]){
  const a=sourceMathAnnotations(text);assert.equal(a.review.length,256);assert.equal(a.review.at(-1).kind,'limit');assert.match(a.review.at(-1).reason,/review findings exceed/);assert.equal(a.formulas.length,0);
 }
});
test('piecewise row and decoration extraction enforce limits during iteration',()=>{
 const text='$$'+String.raw`C=\begin{cases}`+Array(1000).fill(String.raw`x&d=0`).join(String.raw`\\`)+String.raw`\end{cases}`+'$$';
 const a=sourceMathAnnotations(text);assert.equal(a.formulas[0].cases.length,128);assert.ok(a.review.some(issue=>issue.kind==='limit'&&/piecewise rows/.test(issue.reason)));
 const symbols='$$'+Array(1000).fill(String.raw`\bar{H}`).join('+')+'$$';const b=sourceMathAnnotations(symbols);assert.equal(b.formulas[0].decoratedIdentifiers.length,128);assert.ok(b.review.some(issue=>issue.kind==='limit'&&/decorated identifiers/.test(issue.reason)));
});
test('oversized formulas retain exact source without parsing unbounded cases or decorations',()=>{
 const source=String.raw`C=\begin{cases}`+Array(10000).fill(String.raw`\bar{H}&d=0`).join(String.raw`\\`)+String.raw`\end{cases}`;
 const a=sourceMathAnnotations('$$'+source+'$$');assert.equal(a.formulas[0].source,source);assert.equal(a.formulas[0].syntax,'not-checked');assert.deepEqual(a.formulas[0].cases,[]);assert.deepEqual(a.formulas[0].decoratedIdentifiers,[]);assert.ok(a.review.some(issue=>issue.kind==='limit'));
});
