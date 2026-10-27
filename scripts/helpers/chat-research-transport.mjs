import assert from 'node:assert/strict';

// Identify the task before applying Chat-only modes or counting dispatches.
// Keep persona, grounding and registry assertions in respond: those must fail
// visibly for Chat, rather than making a broken Chat payload disappear.
export function chatResearchTransport(respond) {
 const requests=[],unexpected=[];
 return {requests,unexpected,async send(url,options) {
  const payload=JSON.parse(options.body);
  if(typeof payload?.instructions!=='string'||!payload.instructions.startsWith('You are Noema Knowledge Chat, a neutral read-only research interface.')) {
   unexpected.push(payload);
   assert.fail('Unexpected non-Chat provider dispatch in isolated research fixture');
  }
  requests.push(payload);
  return respond(payload,options,url);
 }};
}
