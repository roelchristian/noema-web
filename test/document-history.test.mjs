import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture,historyHarness,instrumentHistory} from './helpers/document-history.mjs';

const fixture=()=>historyFixture(3);
test('contiguous native typing coalesces and restores text caret through undo/redo',async()=>{
  const initial=fixture(),text=initial.blocks[0].content[0].text;
  await historyHarness(initial,async h=>{
    h.caret(text.length);
    await h.type('a');await h.type('b');
    assert.equal(h.page().blocks[0].content[0].text,text+'ab');
    await h.step(history=>history.undo());
    assert.equal(h.page().blocks[0].content[0].text,text);
    assert.equal(document.getSelection().anchorOffset,text.length);
    assert.equal(h.history().canUndo,false);
    await h.step(history=>history.redo());
    assert.equal(h.page().blocks[0].content[0].text,text+'ab');
    assert.equal(document.getSelection().anchorOffset,text.length+2);
  });
});
test('caret moves split typing; native history events use the same timeline',async()=>{
  await historyHarness(fixture(),async h=>{
    await h.type('a');h.caret(0);await h.type('b');
    const undo=new h.dom.window.InputEvent('beforeinput',{inputType:'historyUndo',bubbles:true,cancelable:true});
    await h.step(()=>h.host().dispatchEvent(undo));
    assert.equal(undo.defaultPrevented,true);assert.equal(h.history().canUndo,true);
    assert.ok(h.page().blocks[0].content[0].text.endsWith('a'));
    await h.step(()=>h.host().dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true})));
    assert.ok(h.page().blocks[0].content[0].text.endsWith('ab'));
  });
});
test('IME updates coalesce within one composition and separate successive compositions',async()=>{
  await historyHarness(fixture(),async h=>{
    for(const text of ['文','字']) {
      await h.step(()=>h.host().dispatchEvent(new h.dom.window.CompositionEvent('compositionstart',{bubbles:true})));
      await h.type(text,'insertCompositionText',true);await h.type(text,'insertCompositionText',true);
      await h.step(()=>h.host().dispatchEvent(new h.dom.window.CompositionEvent('compositionend',{bubbles:true})));
    }
    await h.step(history=>history.undo());assert.equal(h.history().canUndo,true);
    assert.ok(h.page().blocks[0].content[0].text.endsWith('文文'));
    await h.step(history=>history.undo());assert.equal(h.history().canUndo,false);
  });
});
test('synchronous programmatic and explicit formatting commits stay in one transaction',async()=>{
  const initial=fixture();
  await historyHarness(initial,async h=>{
    await h.step(history=>{
      history.change({title:'Formatted'});
      history.change({blocks:h.page().blocks.map((block,i)=>i?block:{...block,content:[{text:'Formatted',italic:true}]})});
    });
    await h.step(history=>history.undo());assert.deepEqual(h.page().blocks,initial.blocks);
    assert.equal(h.page().title,initial.title);assert.equal(h.history().canUndo,false);
    await h.step(history=>history.redo());assert.equal(h.page().title,'Formatted');
    assert.equal(h.page().blocks[0].content[0].italic,true);
  });
});
test('title selection, structural changes, redo invalidation, and equal-content no-ops',async()=>{
  await historyHarness(fixture(),async h=>{
    const title=document.querySelector('#page-title');title.focus();title.setSelectionRange(2,5,'backward');
    document.dispatchEvent(new Event('selectionchange'));
    await h.change({title:'New title'});
    await h.step(history=>history.undo());
    assert.equal(title.selectionStart,2);assert.equal(title.selectionEnd,5);assert.equal(title.selectionDirection,'backward');
    await h.change({blocks:[...h.page().blocks].reverse()});assert.equal(h.history().canRedo,false);
    const reordered=structuredClone(h.page().blocks);
    await h.change({blocks:structuredClone(reordered)});
    await h.step(history=>history.undo());assert.equal(h.history().canUndo,false);
    await h.step(history=>history.redo());assert.deepEqual(h.page().blocks,reordered);
  });
});
test('all nested block metadata remains visible to comparison',async()=>{
  const variants=[
    {checked:true},{semantic:'claim'},{semanticGroup:{id:'group',kind:'evidence'}},
    {column:{id:'columns',index:0}},{imageId:'image',alt:'Caption'},
    {rows:[[[{text:'cell',skipAutoTag:true,entityId:'entity',bold:true}]]]},
    {content:[{text:'unchanged prose',italic:true,skipAutoTag:true}]},
  ];
  for(const patch of variants)await historyHarness(fixture(),async h=>{
    const before=structuredClone(h.page().blocks);
    await h.change({blocks:h.page().blocks.map((block,i)=>i?block:{...block,...patch})});
    assert.equal(h.history().canUndo,true);
    await h.step(history=>history.undo());assert.deepEqual(h.page().blocks,before);
    await h.step(history=>history.redo());assert.deepEqual(h.page().blocks[0],{...before[0],...patch});
  });
  await historyHarness(fixture(),async h=>{
    await h.change({featuredImageId:'image'});await h.step(history=>history.undo());
    assert.equal(h.page().featuredImageId,null);
    await h.step(history=>history.redo());assert.equal(h.page().featuredImageId,'image');
  });
});
test('snapshots detach initial page, caller patches, outgoing patches, and replay results',async()=>{
  const initial=fixture(),original=structuredClone(initial.blocks);
  await historyHarness(initial,async h=>{
    const blocks=structuredClone(initial.blocks);blocks[0].content[0].text='Committed';
    await h.change({blocks});
    initial.blocks[0].content[0].text='Mutated initial';blocks[0].content[0].text='Mutated patch';
    h.outgoing().blocks[0].content[0].text='Mutated outgoing';
    await h.step(history=>history.undo());assert.deepEqual(h.page().blocks,original);
    h.outgoing().blocks[0].content[0].text='Mutated replay';
    await h.step(history=>history.redo());assert.equal(h.page().blocks[0].content[0].text,'Committed');
    await h.step(history=>history.undo());assert.deepEqual(h.page().blocks,original);
  });
});
test('reconciliation detects in-place caller mutations, updates latest transaction, and ends typing',async()=>{
  await historyHarness(fixture(),async h=>{
    await h.type('a');
    const external=h.page();external.blocks[1].checked=true;
    await h.replace(external);
    await h.type('b');await h.step(history=>history.undo());
    assert.equal(h.page().blocks[1].checked,true);assert.equal(h.history().canUndo,true);
    await h.step(history=>history.undo());assert.equal(h.page().blocks[1].checked,false);
    await h.step(history=>history.redo());assert.equal(h.page().blocks[1].checked,true);
  });
});
test('equal-content parent echoes preserve the active typing run',async()=>{
  await historyHarness(fixture(),async h=>{
    await h.type('a');await h.replace(structuredClone(h.page()));await h.type('b');
    await h.step(history=>history.undo());assert.equal(h.history().canUndo,false);
  });
});
test('page/vault replacement, reset events, disabled and locked histories are isolated',async()=>{
  await historyHarness(fixture(),async h=>{
    await h.change({title:'Edit'});await h.disabled(true);
    await h.step(history=>history.undo());assert.equal(h.page().title,'Edit');
    await h.change({title:'Ignored'});assert.equal(h.page().title,'Edit');
    await h.disabled(false);await h.replace({...h.page(),editLocked:true});
    await h.step(history=>history.undo());assert.equal(h.page().title,'Edit');
    await h.replace({...fixture(),vault_id:'other'});assert.equal(h.history().canUndo,false);
    await h.change({title:'Other edit'});
    const replacement={...h.page(),title:'Restored backup'};
    await h.step(()=>document.dispatchEvent(new CustomEvent('noema:document-replaced',{detail:replacement})));
    await h.replace(replacement);assert.equal(h.history().canUndo,false);
    await h.change({title:'After reset'});await h.step(history=>history.undo());assert.equal(h.page().title,'Restored backup');
  });
});
test('virtual trailing paragraphs survive the first edit and coalesce with subsequent typing',async()=>{
  await historyHarness(fixture(),async h=>{
    const tail=document.createElement('div');tail.dataset.blockId='tail';tail.className='paragraph';
    document.querySelector('#blocks').append(tail);
    const initial=structuredClone(h.page().blocks);
    await h.step(history=>{
      h.host().dispatchEvent(new h.dom.window.InputEvent('beforeinput',{inputType:'insertText',bubbles:true}));
      const blocks=[...initial,{id:'tail',type:'paragraph',checked:false,content:[]}];
      blocks[0]={...blocks[0],content:[{text:'First key'}]};
      h.host().textContent='First key';h.caret(9);
      history.change({blocks});
    });
    await h.type('b');
    await h.step(history=>history.undo());assert.equal(h.history().canUndo,false);
    assert.equal(h.page().blocks.at(-1).id,'tail');
    assert.deepEqual(h.page().blocks.at(-1).content,[]);
  });
});
test('whole-document operation counts remain bounded while typing coalesces',async()=>{
  for(const count of [200,1000])await historyHarness(historyFixture(count),async h=>{
    const meter=instrumentHistory(count);
    try {await h.type('a');await h.type('b');}finally {meter.stop();}
    assert.equal(meter.totals.clone.count,4);assert.equal(meter.totals.stringify.count,4);
    assert.equal(meter.totals.shape.count,4);
    await h.step(history=>history.undo());assert.equal(h.history().canUndo,false);
  });
});

test('native input survives a microtask checkpoint before React commits the edit',async()=>{
  await historyHarness(fixture(),async h=>{
    const original=h.page().blocks[0].content[0].text;
    for(const letter of ['x','y','z'])await h.step(async history=>{
      const host=h.host();h.caret(host.textContent.length);
      host.dispatchEvent(new h.dom.window.InputEvent('beforeinput',{inputType:'insertText',bubbles:true}));
      const content=[{...h.page().blocks[0].content[0],text:host.textContent+letter}];
      host.textContent=content[0].text;h.caret(content[0].text.length);
      host.dispatchEvent(new h.dom.window.InputEvent('input',{inputType:'insertText',bubbles:true}));
      // Chromium can run this checkpoint between the document's capture
      // listener and React's delegated input listener.
      await Promise.resolve();
      history.change({blocks:h.page().blocks.map((block,i)=>i?block:{...block,content})});
    });
    await h.step(history=>history.undo());
    assert.equal(h.page().blocks[0].content[0].text,original);
    assert.equal(h.history().canUndo,false);
    await h.step(history=>history.redo());
    assert.equal(h.page().blocks[0].content[0].text,original+'xyz');
  });
});
