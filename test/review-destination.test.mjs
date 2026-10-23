import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewDestinationAt} from '../src/client/review/review-destination.ts';

const location={vault:{id:'vault',locked:false},view:'pages',page:{id:'origin'},entityId:'origin',sourceId:'origin'};
const item=category=>({id:category+':origin',category,originId:'origin',title:'Original work',group:'decisions',state:'pending',decision:'Review suggestions',count:1,updatedAt:'2026-10-23'});

test('review return and deep-link intent only appear on the original specialized workspace',()=>{
 for(const [category,view,key] of [['scan','pages','page'],['discovery','entity','entityId'],['editorial','source','sourceId'],['source','source','sourceId']]){
  const destination=item(category),target={...location,view};
  assert.equal(reviewDestinationAt(destination,'vault',target),destination);
  assert.equal(reviewDestinationAt(destination,'vault',{...target,[key]:key==='page'?{id:'another'}:'another'}),null);
  for(const otherView of ['review','organization','entities','calendar','trash']){
   assert.equal(reviewDestinationAt(destination,'vault',{...target,view:otherView}),null);
  }
  // Internal back navigation can restore the same review workspace and its selected run.
  assert.equal(reviewDestinationAt(destination,'vault',target),destination);
 }
});

test('review navigation intent cannot expose a title or selection outside its unlocked vault',()=>{
 const destination=item('scan');
 assert.equal(reviewDestinationAt(destination,'other',location),null);
 assert.equal(reviewDestinationAt(destination,'vault',{...location,vault:{id:'vault',locked:true}}),null);
 assert.equal(reviewDestinationAt(destination,'vault',{...location,vault:null}),null);
 assert.equal(reviewDestinationAt(null,'vault',location),null);
});


test('property and temporal review intent stays with the exact subject and date',()=>{
 const property=item('property');assert.equal(reviewDestinationAt(property,'vault',{...location,view:'entity'}),property);assert.equal(reviewDestinationAt(property,'vault',{...location,view:'source'}),property);assert.equal(reviewDestinationAt(property,'vault',{...location,view:'entity',entityId:'other'}),null);
 const temporal={...item('temporal'),dateId:'julian:month:1905-03',proposalId:'relation'};
 assert.equal(reviewDestinationAt(temporal,'vault',{...location,view:'calendar',calendarDateId:temporal.dateId}),temporal);
 assert.equal(reviewDestinationAt(temporal,'vault',{...location,view:'calendar',calendarDateId:'gregorian:month:1905-03'}),null);
 assert.equal(reviewDestinationAt(temporal,'vault',{...location,view:'calendar',calendarDateId:null}),null);
});
