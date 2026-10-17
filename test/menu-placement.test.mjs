import {test} from 'node:test';
import assert from 'node:assert/strict';
import {menuPlacement,revealMenuItem} from '../src/client/components/menu-placement.ts';

test('vault menus open above the sidebar footer without crossing the viewport',()=>{
  const position=menuPlacement({left:16,right:248,top:730,bottom:764},232,280,{left:0,top:0,width:1200,height:800});
  assert.equal(position.left,16);assert.equal(position.top,445);assert.equal(position.width,232);
  assert.ok(position.top+280<730);assert.ok(position.maxHeight>=280);
});
test('long menus fit the available side and scroll within their own bounds',()=>{
  const position=menuPlacement({left:16,right:248,top:390,bottom:424},232,1000,{left:0,top:0,width:800,height:460});
  assert.equal(position.top,8);assert.equal(position.maxHeight,377);
  assert.ok(position.top+position.maxHeight<=390);
});
test('placement respects horizontal edges and the visible viewport during zoom or keyboard resize',()=>{
  const position=menuPlacement({left:390,right:430,top:260,bottom:290},240,300,{left:100,top:150,width:340,height:260},'end',300);
  assert.ok(position.left>=108);assert.ok(position.left+position.width<=432);
  assert.ok(position.top>=158);assert.ok(position.top+position.maxHeight<=402);
  const small=menuPlacement({left:3,right:50,top:60,bottom:85},210,300,{left:0,top:0,width:170,height:200},'end');
  assert.equal(small.width,154);assert.equal(small.left,8);
});
test('normal menus open below their trigger when there is room',()=>{
  const position=menuPlacement({left:100,right:180,top:40,bottom:70},210,180,{left:0,top:0,width:800,height:600},'end');
  assert.equal(position.top,75);assert.equal(position.left,8);
});
test('keyboard selection scrolls the popup only and hovering an already visible row leaves scrolling alone',()=>{
  const menu={scrollTop:0,clientHeight:160};
  revealMenuItem(menu,{offsetTop:300,offsetHeight:32});assert.equal(menu.scrollTop,177);
  revealMenuItem(menu,{offsetTop:20,offsetHeight:32});assert.equal(menu.scrollTop,15);
  revealMenuItem(menu,{offsetTop:50,offsetHeight:32});assert.equal(menu.scrollTop,15);
});
