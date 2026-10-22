import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewMentionCount} from '../src/client/intelligence/entity-review-mentions.ts';

test('mention counts include aliases, linked text and table cells without counting overlapping names twice',()=>{
 const page={blocks:[{content:[{text:'Mike DeWine met DeWine. '},{entityId:'mike',mentionText:'Mike DeWine'},{text:' met DEWINE. DeWines is not a match.'}]},{content:[],rows:[[[{text:'DeWine'}],[{text:'Mike DeWine'}]]]}]};
 assert.equal(reviewMentionCount(page,['Mike DeWine','DeWine','DeWine']),6);
});

test('mention counting handles punctuation, curly apostrophes, split text and saved canonical names',()=>{
 const page={blocks:[{content:[{text:'Ohio’s capital '},{text:'punishment; C++ and C++. '},{entityId:'mike'}]}]};
 assert.equal(reviewMentionCount(page,["Ohio's capital punishment",'C++']),3);
 assert.equal(reviewMentionCount(page,['Mike DeWine'],[{id:'mike',name:'Mike DeWine'}]),1);
 assert.equal(reviewMentionCount(page,['','  ']),0);
});

test('context windows include one line on each side and merge adjacent mentions',async()=>{
 const {reviewContextWindows,reviewMentionAnchors}=await import('../src/client/intelligence/entity-review-mentions.ts');
 assert.deepEqual(reviewContextWindows([true,false,false,false,false,false,false,false,true]),[{start:0,end:2},{start:7,end:9}]);
 assert.deepEqual(reviewContextWindows([false,false,true,false,true,false,false]),[{start:1,end:6}]);
 assert.deepEqual(reviewContextWindows([false,false]),[]);
 const page={blocks:[{id:'p',content:[{text:'Mira met Mira.'}]},{id:'t',content:[],rows:[[[{text:'Mira'}]]]}]};
 assert.deepEqual(reviewMentionAnchors(page,['Mira']),[{blockId:'p',start:0,end:4},{blockId:'p',start:9,end:13},{blockId:'t',row:0,col:0,start:0,end:4}]);
});
