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
test('the final saved decision completes accepted, mixed and entirely rejected reviews',()=>{
 const cases=[
  {label:'acceptance after rejection',statuses:['rejected','accepted'],decision:'accepted',verb:'connected'},
  {label:'rejection after acceptance',statuses:['accepted','rejected'],decision:'rejected',verb:'rejected'},
  {label:'all rejected',statuses:['rejected','rejected'],decision:'rejected',verb:'rejected'},
 ];
 for(const {label,statuses,decision,verb} of cases){
  const feedback=entityReviewFeedback(scan(...statuses),['1'],decision);
  assert.equal(feedback.complete,true,label);assert.equal(feedback.message,'Review complete',label);
  assert.equal(feedback.detail,`Earthsea ${verb}. All decisions saved.`,label);
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
