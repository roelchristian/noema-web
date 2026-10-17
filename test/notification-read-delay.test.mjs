import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleNotificationRead} from '../src/client/intelligence/notification-read-delay.ts';

function visibility() {
  const target=new EventTarget();
  target.visibilityState='visible';
  return target;
}
test('notifications become read only after the menu has been visible for three seconds',context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  let reads=0;
  const cancel=scheduleNotificationRead(()=>reads++,visibility());
  context.mock.timers.tick(2999);assert.equal(reads,0);
  context.mock.timers.tick(1);assert.equal(reads,1);
  context.mock.timers.tick(3000);assert.equal(reads,1);
  cancel();
});
test('closing early cancels the read and reopening starts a fresh delay',context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  let reads=0;const document=visibility();
  const cancel=scheduleNotificationRead(()=>reads++,document);
  context.mock.timers.tick(2999);cancel();
  context.mock.timers.tick(3000);assert.equal(reads,0);
  const close=scheduleNotificationRead(()=>reads++,document);
  context.mock.timers.tick(2999);assert.equal(reads,0);
  context.mock.timers.tick(1);assert.equal(reads,1);close();
});
test('time spent with the browser hidden does not count as reading',context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  let reads=0;const document=visibility();
  const cancel=scheduleNotificationRead(()=>reads++,document);
  context.mock.timers.tick(2000);
  document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));
  context.mock.timers.tick(10000);assert.equal(reads,0);
  document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));
  context.mock.timers.tick(2999);assert.equal(reads,0);
  context.mock.timers.tick(1);assert.equal(reads,1);cancel();
});
