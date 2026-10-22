import {test} from 'node:test';
import assert from 'node:assert/strict';
import {languageComposition,languageCompositionChanged} from '../src/server/modules/page-language-composition.ts';

test('language reconsideration distinguishes small edits, script changes, replacement and missing baselines',()=>{
 const cases=[
  ['small same-language edit','Algebra studies polynomial equations and proofs.','Algebra studies polynomial equations, proofs and examples.',false],
  ['major script change','Mathematics and algebra','代数学と数学の方程式',true],
  ['substantial Latin-language replacement','The historical account discusses ancient empires and their political institutions with many examples from surviving records.','Cette analyse historique explique plusieurs royaumes anciens leurs institutions politiques ainsi que divers exemples provenant des archives conservées.',true],
  ['missing baseline',null,'Cette analyse historique explique plusieurs royaumes anciens leurs institutions politiques ainsi que divers exemples provenant des archives conservées.',false],
 ];
 for(const [label,before,after,expected] of cases)assert.equal(languageCompositionChanged(before===null?null:languageComposition(before),languageComposition(after)),expected,label);
});
