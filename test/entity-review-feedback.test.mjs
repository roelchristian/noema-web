import {test} from 'node:test';
import assert from 'node:assert/strict';
import {entityReviewFeedback} from '../src/client/intelligence/entity-review-feedback.ts';
const scan=(...statuses)=>({id:'scan',revision:2,suggestions:statuses.map((status,index)=>({id:String(index),name:['Ursula','Earthsea','Ged'][index],status}))});

test('an accepted suggestion confirms its saved connection while remaining work stays open',()=>{
  const feedback=entityReviewFeedback(scan('accepted','pending'),['0'],'accepted');
  assert.equal(feedback.complete,false);
  assert.equal(feedback.message,'Ursula connected');
  assert.equal(feedback.detail,'1 suggestion left to review.');
  assert.deepEqual(feedback.ids,['0']);
});
test('the final acceptance completes a review that includes earlier rejections',()=>{
  const feedback=entityReviewFeedback(scan('rejected','accepted'),['1'],'accepted');
  assert.equal(feedback.complete,true);
  assert.equal(feedback.message,'Review complete');
  assert.match(feedback.detail,/Earthsea connected\. All decisions saved\./);
});
test('the final rejection completes a review including mixed or entirely rejected decisions',()=>{
  for(const statuses of [['accepted','rejected'],['rejected','rejected']]) {
    const feedback=entityReviewFeedback(scan(...statuses),['1'],'rejected');
    assert.equal(feedback.complete,true);
    assert.match(feedback.detail,/Earthsea rejected\. All decisions saved\./);
  }
});
test('bulk decisions confirm the saved count and require every suggestion to be reviewed',()=>{
  const partial=entityReviewFeedback(scan('accepted','accepted','pending'),['0','1'],'accepted');
  assert.equal(partial.message,'2 entities connected');
  assert.equal(partial.complete,false);
  const complete=entityReviewFeedback(scan('accepted','accepted','rejected'),['0','1'],'accepted');
  assert.equal(complete.complete,true);
  assert.match(complete.detail,/2 entities connected/);
});
test('an unchanged or failed decision never generates a completion confirmation',()=>{
  assert.equal(entityReviewFeedback(scan('pending'),['0'],'accepted'),null);
  assert.equal(entityReviewFeedback(scan('accepted'),['missing'],'accepted'),null);
  assert.equal(entityReviewFeedback(scan('rejected'),['0'],'accepted'),null);
  assert.equal(entityReviewFeedback(scan(),[],'rejected'),null);
});
