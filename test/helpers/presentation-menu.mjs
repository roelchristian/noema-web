import assert from 'node:assert/strict';
import {act} from 'react';

/** Native popovers and layout are absent in JSDOM. Keep mode tests on the real menu. */
export function setupPresentationMenu(dom) {
 const prototype=dom.window.HTMLElement.prototype,open=new WeakSet(),matches=prototype.matches;
 prototype.matches=function(selector){return selector===':popover-open'?open.has(this):matches.call(this,selector);};
 prototype.showPopover=function(){open.add(this);};
 prototype.hidePopover=function(){open.delete(this);};
 prototype.getBoundingClientRect=()=>({left:10,right:110,top:10,bottom:30,width:100,height:20});
 prototype.getAnimations=()=>[];
}

export async function choosePresentationMode(scope,name) {
 const trigger=document.querySelector(scope+' .presentation-control [aria-label="Presentation mode"]');
 assert.ok(trigger,'Presentation menu trigger is available');
 await act(async()=>trigger.click());
 assert.equal(trigger.getAttribute('aria-expanded'),'true');
 const menu=document.getElementById(trigger.getAttribute('aria-controls'));
 assert.ok(menu,'Trigger identifies its presentation menu');
 const option=menu.querySelector('[role="menuitemcheckbox"][aria-label="'+name+'"]');
 assert.ok(option,'Presentation mode '+name+' is available');
 assert.equal(option.disabled,false);
 await act(async()=>option.click());
}
