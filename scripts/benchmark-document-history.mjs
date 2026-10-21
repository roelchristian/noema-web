// node --import tsx scripts/benchmark-document-history.mjs [edits=30]
import {historyFixture,historyHarness,instrumentHistory} from '../test/helpers/document-history.mjs';
const edits=Number(process.argv[2]??30);
const results=[];
for(const blocks of [200,1000,2000]) {
  for(const mode of ['programmatic','coalesced typing']) {
    await historyHarness(historyFixture(blocks),async h=>{
      // Warm React and selection code without creating a history entry.
      await h.step(()=>{});
      const meter=instrumentHistory(blocks);
      try {
        for(let i=0;i<edits;i++) {
          if(mode==='coalesced typing')await h.type('x');
          else await h.change({blocks:h.page().blocks.map((block,index)=>index?block:{...block,checked:!block.checked})});
        }
      } finally {meter.stop();}
      const measurements=structuredClone(meter.totals);
      let undos=0;
      while(h.history().canUndo){await h.step(history=>history.undo());undos++;}
      results.push({blocks,mode,edits,undoTransactions:undos,...measurements});
    });
  }
}
console.log(JSON.stringify({node:process.version,note:'Counts deterministic for this mounted-hook harness; ms are measured aggregate operation time, excluding rendering. Shape serialization is reported separately.',results},null,2));
