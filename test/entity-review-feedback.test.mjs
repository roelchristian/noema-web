import {test} from 'node:test';
import assert from 'node:assert/strict';
import {entityReviewFeedback} from '../src/client/intelligence/entity-review-feedback.ts';
const scan=(...statuses)=>({id:'scan',revision:2,suggestions:statuses.map((status,index)=>({id:String(index),name:['Ursula','Earthsea','Ged'][index],status}))});

test('an accepted suggestion confirms its saved decision while remaining work stays open',()=>{
  const feedback=entityReviewFeedback(scan('accepted','pending'),['0'],'accepted');
  assert.equal(feedback.complete,false);
  assert.equal(feedback.message,'Ursula accepted');
  assert.equal(feedback.detail,'Ursula accepted. 1 suggestion left to review.');
  assert.deepEqual(feedback.ids,['0']);
});
test('the final saved decision completes accepted, mixed and entirely rejected reviews',()=>{
 const cases=[
  {label:'acceptance after dismissal',statuses:['rejected','accepted'],decision:'accepted',verb:'accepted'},
  {label:'dismissal after acceptance',statuses:['accepted','rejected'],decision:'rejected',verb:'dismissed'},
  {label:'all dismissed',statuses:['rejected','rejected'],decision:'rejected',verb:'dismissed'},
 ];
 for(const {label,statuses,decision,verb} of cases){
  const feedback=entityReviewFeedback(scan(...statuses),['1'],decision);
  assert.equal(feedback.complete,true,label);assert.equal(feedback.message,'All suggestions reviewed',label);
  assert.equal(feedback.detail,`Earthsea ${verb}. All decisions saved.`,label);
 }
});
test('bulk decisions confirm the saved count and require every suggestion to be reviewed',()=>{
  const partial=entityReviewFeedback(scan('accepted','accepted','pending'),['0','1'],'accepted');
  assert.equal(partial.message,'2 entities accepted');
  assert.equal(partial.complete,false);
  const complete=entityReviewFeedback(scan('accepted','accepted','rejected'),['0','1'],'accepted');
  assert.equal(complete.complete,true);
  assert.match(complete.detail,/2 entities accepted/);
});
test('reviewing every saved suggestion completes the batch while more text remains to scan',()=>{
  const result={...scan('accepted','rejected'),continuation:{token:'checkpoint'}};
  const feedback=entityReviewFeedback(result,['1'],'rejected');
  assert.equal(feedback.complete,false);
  assert.equal(feedback.message,'This batch is reviewed');
  assert.equal(feedback.detail,'Earthsea dismissed. All decisions saved. More text remains to scan.');
});
test('pending subtype suggestions prevent completion even when all entities are reviewed',()=>{
  const result={...scan('accepted'),subtypeSuggestions:[{id:'subtype',name:'Author',status:'pending'}]};
  const feedback=entityReviewFeedback(result,['0'],'accepted');
  assert.equal(feedback.complete,false);
  assert.equal(feedback.message,'Ursula accepted');
  assert.equal(feedback.detail,'Ursula accepted. 1 suggestion left to review.');
});
test('subtype-only and mixed decisions use consistent terminology and preserve action details',()=>{
  const subtypes={...scan(),subtypeSuggestions:[{id:'author',name:'Author',status:'accepted'},{id:'mage',name:'Mage',status:'accepted'}]};
  const subtypeFeedback=entityReviewFeedback(subtypes,['author','mage'],'accepted');
  assert.equal(subtypeFeedback.complete,true);
  assert.equal(subtypeFeedback.detail,'2 subtypes accepted. All decisions saved.');
  const mixed=entityReviewFeedback({...subtypes,suggestions:scan('accepted').suggestions},['0','author'],'accepted');
  assert.equal(mixed.detail,'2 suggestions accepted. All decisions saved.');
});
test('an unchanged or failed decision never generates a completion confirmation',()=>{
  assert.equal(entityReviewFeedback(scan('pending'),['0'],'accepted'),null);
  assert.equal(entityReviewFeedback(scan('accepted'),['missing'],'accepted'),null);
  assert.equal(entityReviewFeedback(scan('rejected'),['0'],'accepted'),null);
  assert.equal(entityReviewFeedback(scan(),[],'rejected'),null);
});
