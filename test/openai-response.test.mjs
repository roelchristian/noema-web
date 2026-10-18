import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readOpenAIResponse,responseOutputText} from '../src/server/modules/openai-response.ts';
import {SourcePageDraft} from '../src/server/modules/source-pages.ts';

const message=(id,text,phase)=>({id,type:'message',phase,content:[{type:'output_text',text}]});
const sse=events=>new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
function streamedMessages(messages){
 return messages.flatMap((item,index)=>[
  {type:'response.output_item.added',item,output_index:index},
  ...Array.from(item.content[0].text).map(delta=>({type:'response.output_text.delta',item_id:item.id,output_index:index,content_index:0,delta})),
 ]);
}
test('only the final-answer draft reaches the source parser, while commentary stays in the trace',async()=>{
 const preliminary='Not JSON: preliminary reasoning\n'+JSON.stringify({type:'title',title:'Preliminary title'});
 const final=[{type:'title',title:'Groups of order 3'},{type:'block',blockType:'paragraph',basis:'source',text:'The group is cyclic.',citations:[{startLine:1,endLine:1}]}].map(JSON.stringify).join('\n');
 const messages=[message('preliminary',preliminary,'commentary'),message('final',final,'final_answer')];
 const events=[...streamedMessages(messages),{type:'response.completed',response:{status:'completed',output:messages}}];
 const traced=[],draft=new SourcePageDraft(()=>{},'The group is cyclic.');
 const trace={headers(){},event(type){traced.push(type);},response(){},body(){}};
 const result=await readOpenAIResponse(sse(events),trace,delta=>draft.feed(delta));
 draft.finish();
 assert.equal(draft.title,'Groups of order 3');assert.equal(draft.blocks.length,1);
 assert.equal(responseOutputText(result),final);
 assert.equal(traced.filter(type=>type==='response.output_text.delta').length,preliminary.length+final.length);
});
test('multiple final message parts use the same separators in streaming and final output',async()=>{
 const messages=[message('one','First','final_answer'),message('two','Second','final_answer')],deltas=[];
 const result=await readOpenAIResponse(sse([...streamedMessages(messages),{type:'response.completed',response:{status:'completed',output:messages}}]),undefined,delta=>deltas.push(delta));
 assert.equal(deltas.join(''),'First\nSecond');assert.equal(responseOutputText(result),'First\nSecond');
});
test('legacy messages without phase and JSON fallback still produce output',async()=>{
 const messages=[message('legacy','A complete response')],deltas=[];
 await readOpenAIResponse(sse([...streamedMessages(messages),{type:'response.completed',response:{status:'completed',output:messages}}]),undefined,delta=>deltas.push(delta));
 assert.equal(deltas.join(''),'A complete response');
 const fallback=[];
 await readOpenAIResponse(new Response(JSON.stringify({status:'completed',output:messages}),{headers:{'Content-Type':'application/json'}}),undefined,delta=>fallback.push(delta));
 assert.equal(fallback.join(''),'A complete response');
});
test('a real final-answer mismatch remains an error',async()=>{
 const messages=[message('final','Streamed text','final_answer')];
 await assert.rejects(readOpenAIResponse(sse([...streamedMessages(messages),{type:'response.completed',response:{status:'completed',output:[message('final','Different final text','final_answer')]}}]),undefined,()=>{}),/did not match/);
});
