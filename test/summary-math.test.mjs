import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {SummaryText} from '../src/client/intelligence/SummaryText.tsx';
import {IntelligencePanel} from '../src/client/intelligence/IntelligencePanel.tsx';
import {api} from '../src/client/api.ts';
const render=text=>new JSDOM(renderToStaticMarkup(React.createElement(SummaryText,{text})));
test('summaries render both inline and display math delimiter styles with accessible MathML',()=>{
 const text=String.raw`Inline $x^2$ and \(a+b\). Display $$\frac{1}{2}$$ and \[\sum_{i=1}^n i\].`;
 const dom=render(text);try{
  const body=dom.window.document.body;
  assert.equal(body.querySelectorAll('.summary-math-inline').length,2);assert.equal(body.querySelectorAll('.summary-math-display').length,2);assert.equal(body.querySelectorAll('math').length,4);assert.equal(body.querySelectorAll('.katex-display').length,2);
  assert.deepEqual(Array.from(body.querySelectorAll('annotation')).map(node=>node.textContent),['x^2','a+b',String.raw`\frac{1}{2}`,String.raw`\sum_{i=1}^n i`]);
  assert.match(body.textContent,/Inline/);assert.match(body.textContent,/and/);
 }finally{dom.window.close();}
});
test('multiline display equations render beside surrounding prose',()=>{
 const dom=render('Before\n\\[\na^2+b^2=c^2\n\\]\nAfter');try{
  assert.equal(dom.window.document.querySelectorAll('.summary-math-display').length,1);assert.equal(dom.window.document.querySelector('annotation').textContent,'a^2+b^2=c^2');assert.match(dom.window.document.body.textContent,/Before[\s\S]*After/);
 }finally{dom.window.close();}
});
test('literal code, escaped and incomplete delimiters, currency and plain text remain unchanged',()=>{
 for(const text of [String.raw`Code \`$x$\` and \`\(y\)\`.`,String.raw`\$x\$ and \\(y\\)`,String.raw`$unfinished and \[unfinished`, '$5 and $10', 'No math <b>here</b>.']){
  const dom=render(text);try{assert.equal(dom.window.document.querySelector('.katex'),null,text);assert.equal(dom.window.document.body.textContent,text);}finally{dom.window.close();}
 }
 const dom=render('`$code$` then $x$');try{assert.equal(dom.window.document.querySelectorAll('.katex').length,1);assert.match(dom.window.document.body.textContent,/`\$code\$` then/);}finally{dom.window.close();}
});
test('summary HTML stays escaped and untrusted LaTeX cannot create executable links',()=>{
 const dom=render(String.raw`<img src=x onerror=alert(1)> $\href{javascript:alert(1)}{click}$`);try{
  assert.equal(dom.window.document.querySelector('img'),null);assert.equal(dom.window.document.querySelector('a'),null);assert.match(dom.window.document.body.textContent,/<img src=x onerror=alert\(1\)>/);
 }finally{dom.window.close();}
});
test('invalid LaTeX falls back to readable text without crashing the summary',()=>{
 const dom=render(String.raw`Before $\frac{a}{$ after`);try{assert.ok(dom.window.document.querySelector('.katex-error'));assert.match(dom.window.document.body.textContent,/Before[\s\S]*after/);}finally{dom.window.close();}
});
test('saved and freshly generated summaries both use math rendering without changing their stored text',async t=>{
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
 const keys=['window','document','Node','Element','HTMLElement','Event','MutationObserver','getComputedStyle','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='ResizeObserver'?class{observe(){}disconnect(){}}:dom.window[key]});
 const page={id:'note',vault_id:'default',title:'Math',blocks:[],sourceIds:[],revision:1,updated_at:'',summaryContentHash:'current'};
 const saved=String.raw`Saved \(x^2\)`,fresh=String.raw`New $$\frac{a}{b}$$`;
 t.mock.method(api,'enrichments',async()=>[{kind:'summary',data:{summary:saved},revision:1,contentHash:'old',model:'test',reasoningEffort:'low'}]);
 t.mock.method(api,'summarize',async()=>({summary:fresh,revision:1,contentHash:'current',model:'test',reasoningEffort:'low'}));
 const root=createRoot(document.querySelector('#mount'));
 try{
  await act(async()=>root.render(React.createElement(IntelligencePanel,{page,pages:[],entities:[],onOpenPage(){},onFlush:async()=>page,onClose(){},onSettings(){},onReview(){},onSourcesChange(){},onCreateEntity(){},onOpenEntity(){}})));
  assert.equal(document.querySelector('#knowledge-summary-text annotation').textContent,'x^2');
  const refresh=document.querySelector('[aria-label="Refresh summary"]');assert.ok(refresh);
  await act(async()=>refresh.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
  assert.equal(document.querySelectorAll('#knowledge-summary-text .katex-display').length,1);assert.equal(document.querySelector('#knowledge-summary-text annotation').textContent,String.raw`\frac{a}{b}`);
  assert.equal(saved,String.raw`Saved \(x^2\)`);assert.equal(fresh,String.raw`New $$\frac{a}{b}$$`);
 }finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
});
