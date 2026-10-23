import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transformNarration,maxNarrationTextLength} from '../src/shared/narration-text.ts';
const preferences=(overrides={})=>({locale:'en-US',pronunciations:[],rules:{acronyms:'preserve',abbreviations:'preserve',dates:'preserve',numbers:'preserve'},...overrides});
const entry=(word,spoken,more={})=>({word,spoken,caseSensitive:false,language:'',...more});

test('literal pronunciation entries respect Unicode words, case and language without recursively replacing output',()=>{
 const prefs=preferences({pronunciations:[entry('Noema','noy-ma'),entry('noy-ma','wrong'),entry('API','A P I',{caseSensitive:true}),entry('été','summer',{language:'fr'}),entry('C++','see plus plus'),entry('.*','literal')]});
 assert.equal(transformNarration('Noema NOEMA Noematic éNoema Noemaé API api C++ .*',prefs),'noy-ma noy-ma Noematic éNoema Noemaé A P I api see plus plus literal');
 assert.equal(transformNarration('été étéx',prefs),'été étéx');
 assert.equal(transformNarration('été étéx', {...prefs,locale:'fr-FR'}),'summer étéx');
 assert.equal(prefs.pronunciations[0].word,'Noema');
 assert.equal(transformNarration('New York, York',preferences({pronunciations:[entry('York','short'),entry('New York','long')]})),'long, short');
});

test('rules are opt-in, deterministic and locale aware; invalid dates and embedded identifiers stay authored',()=>{
 const text='NASA Dr. 2024-02-29 2023-02-29 123 A123 URL42';
 assert.equal(transformNarration(text,preferences()),text);
 const prefs=preferences({rules:{acronyms:'spell',abbreviations:'expand',dates:'locale',numbers:'digits'}});
 assert.equal(transformNarration(text,prefs),'N A S A Doctor February 29, 2024 2023-02-29 1 2 3 A123 URL42');
 assert.equal(transformNarration('2024-02-29', {...prefs,locale:'en-GB'}),'29 February 2024');
 assert.equal(transformNarration('Dr. 2024-02-29',{...prefs,locale:'de-DE'}),'Doktor 29. Februar 2024');
 assert.equal(transformNarration('2024-13-01 2024-00-01 0000-01-01',prefs),'2024-13-01 2024-00-01 0000-01-01');
});

test('reading changes preserve fenced/inline code, math and URLs including incomplete fences',()=>{
 const prefs=preferences({pronunciations:[entry('NASA','space agency')],rules:{acronyms:'spell',abbreviations:'expand',dates:'locale',numbers:'digits'}});
 for(const protectedText of ['`NASA 123`','``NASA ` 123``','```js\nNASA 123\n```','~~~text\nNASA 123\n~~~','$$NASA 123$$','$NASA 123$','\\(NASA 123\\)','\\[NASA 123\\]','https://example.test/NASA/123','www.example.test/NASA/123','HTTPS://example.test/NASA/123','ftp://example.test/NASA/123','mailto:NASA123@example.test','](/NASA/123)']){
  const authored=`NASA\n${protectedText}\nNASA`;
  assert.equal(transformNarration(authored,prefs),`space agency\n${protectedText}\nspace agency`,protectedText);
 }
 for(const protectedText of ['```js\nNASA 123','~~~\nNASA 123','$$NASA 123','\\[NASA 123'])assert.equal(transformNarration(protectedText,prefs),protectedText);
});

test('transformation bounds fail explicitly without truncation',()=>{
 assert.throws(()=>transformNarration('x'.repeat(maxNarrationTextLength+1),preferences()),RangeError);
 const prefs=preferences({pronunciations:[entry('x','word '.repeat(100))]});
 assert.throws(()=>transformNarration('x '.repeat(1000),prefs),RangeError);
});
