import {test} from 'node:test';
import assert from 'node:assert/strict';
import {languageComposition,languageCompositionChanged} from '../src/server/modules/page-language-composition.ts';
test('small same-language edits preserve language metadata',()=>{
 const before=languageComposition('Algebra studies polynomial equations and proofs.');
 assert.equal(languageCompositionChanged(before,languageComposition('Algebra studies polynomial equations, proofs and examples.')),false);
});
test('major script composition changes request language reconsideration',()=>{
 assert.equal(languageCompositionChanged(languageComposition('Mathematics and algebra'),languageComposition('代数学と数学の方程式')),true);
});
test('substantial Latin-language replacement can request independent inference',()=>{
 const before=languageComposition('The historical account discusses ancient empires and their political institutions with many examples from surviving records.');
 const after=languageComposition('Cette analyse historique explique plusieurs royaumes anciens leurs institutions politiques ainsi que divers exemples provenant des archives conservées.');
 assert.equal(languageCompositionChanged(before,after),true);
 assert.equal(languageCompositionChanged(null,after),false);
});
