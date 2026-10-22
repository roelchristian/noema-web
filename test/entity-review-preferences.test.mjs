import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreReviewDocumentView,reviewDocumentExpiry} from '../src/client/intelligence/entity-review-preferences.ts';

test('recent matching scans retain their view; new or expired reviews default to excerpts',()=>{
 const now=100_000_000,saved={scanId:'scan',view:'full',lastOpenedAt:now-1000};
 assert.equal(restoreReviewDocumentView(saved,'scan',now),'full');
 assert.equal(restoreReviewDocumentView(saved,'new-scan',now),'excerpts');
 assert.equal(restoreReviewDocumentView({...saved,lastOpenedAt:now-reviewDocumentExpiry},'scan',now),'excerpts');
 assert.equal(restoreReviewDocumentView({...saved,lastOpenedAt:now-reviewDocumentExpiry+1},'scan',now),'full');
 for(const invalid of [null,{},'full',{...saved,view:'unknown'},{...saved,lastOpenedAt:NaN},{...saved,lastOpenedAt:now+1}])assert.equal(restoreReviewDocumentView(invalid,'scan',now),'excerpts');
});
