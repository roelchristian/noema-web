import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('populated HTTP reads are pure, evidence stays private, and ten refreshes do no assessment/vector work',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/benchmark-page-reads.mjs','--assert'],{cwd:new URL('..',import.meta.url),encoding:'utf8'}));
 assert.equal(result.fixture.words,4235);
 assert.equal(result.fixture.segments,9);
 assert.ok(result.status.bytes<256,'status is a compact change check');
 assert.ok(result.enrichments.bytes<2048,'summary payload excludes stored evidence');
 assert.equal(result.summaryOnlyGeneration.knowledgeLists,0,'generation does not repeatedly load the knowledge catalogue');
 assert.equal(result.summaryOnlyGeneration.providerCalls,1,'generation quality retains one mocked provider execution');
});
