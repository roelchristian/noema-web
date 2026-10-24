import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transliterate,blockTransliteration} from '../src/shared/transliteration.ts';

test('Greek includes polytonic vowels, breathings, subscript iota and final sigma',()=>{
  const source='Ἐν ἀρχῇ ἦν ὁ λόγος. αἱ ᾧ ῥυθμός · θεός';
  assert.equal(transliterate(source),'En archē̂i ē̂n ho lógos. hai hō̂i rhythmós · theós');
  assert.equal(transliterate(source.normalize('NFD')),transliterate(source));
  assert.equal(transliterate('Αἱ Θάλασσαι'),'Hai Thálassai');
});

test('Cyrillic handles Russian, Ukrainian, Serbian and other common letters',()=>{
  assert.equal(transliterate('Привет, мир! Ёж, щука.'),'Privet, mir! Yozh, shchuka.');
  assert.equal(transliterate('Українська мова, Љубав, қазақ.'),'Ukrayinsʹka mova, Ljubav, qazaq.');
  assert.equal(transliterate('й ё і ї є ґ ў ә ө ү'),'y yo i yi ye g ŭ ä ö ü');
  assert.equal(transliterate('й ё'.normalize('NFD')),'y yo');
  assert.equal(transliterate('ЩУКА ΘΕΟΣ ⲐⲈⲞⲤ'),'SHCHUKA THEOS THEOS');
});

test('Coptic handles its alphabet and letters in the Greek/Coptic Unicode block',()=>{
  assert.equal(transliterate('Ⲡⲉⲛⲓⲱⲧ ϣⲁ ϯ'),'Peniōt ša ti');
  assert.equal(transliterate('Ϣ Ϥ Ϧ Ϩ Ϫ Ϭ Ϯ'),'Š F Kh H J Č Ti');
});

test('mixed text preserves other scripts, Latin diacritics, punctuation and line breaks',()=>{
  assert.equal(transliterate('Hello café — λόγος\nмир 123 ⲁ 日本語 🙂'),'Hello café — lógos\nmir 123 a 日本語 🙂');
  assert.equal(transliterate('ꙮ'), 'ꙮ','unmapped characters are retained');
});

test('block projection resolves entity labels, leaves code/math intact and skips non-prose',()=>{
  const block={id:'one',type:'paragraph',content:[{text:'λόγος '},{entityId:'e'},{text:' '},{text:'α',math:true},{text:' '},{text:'мир',code:true}]};
  const original=structuredClone(block);
  assert.equal(blockTransliteration(block,[{id:'e',name:'ⲁ'}]),'lógos a α мир');
  assert.deepEqual(block,original);
  assert.equal(blockTransliteration({...block,content:[{entityId:'e',mentionText:'θεός'}]},[{id:'e',name:'ⲁ'}]),'theós');
  for(const type of ['code','table','image','math','divider'])assert.equal(blockTransliteration({...block,type},[]),null);
  assert.equal(blockTransliteration({...block,semantic:'ai-explanation'},[]),null);
  assert.equal(blockTransliteration({...block,content:[{text:'Latin only'}]},[]),null);
});


test('Greek accents remain on vowels before subscript iota, in composed and decomposed text',()=>{
  const source='ά ὰ ᾶ έ ὲ ή ὴ ῆ ί ὶ ῖ ό ὸ ύ ὺ ῦ ώ ὼ ῶ ΐ ΰ ᾄ ᾂ ᾇ';
  const expected='á à â é è ḗ ḕ ē̂ í ì î ó ò ý ỳ ŷ ṓ ṑ ō̂ ḯ ÿ́ ái ài hâi';
  assert.equal(transliterate(source),expected.normalize('NFC'));
  assert.equal(transliterate(source.normalize('NFD')),expected.normalize('NFC'));
});


test('Old Church Slavonic includes historical Cyrillic and Glagolitic without changing the original block',()=>{
  assert.equal(transliterate('Слово ѣ ѧ ѫ ѩ ѭ ѹ ꙋ ꙗ ѿ'),'Slovo ě ę ǫ yę yǫ u u ya ot');
  assert.equal(transliterate('Ⱄⰾⱁⰲⱁ ⱑ ⱔ ⱘ ⱗ ⱙ ⱆ'),'Slovo ě ę ǫ yę yǫ u');
  assert.equal(transliterate('ⰆⰋⰂⰅⰕⰅ'),'ZHIVETE');
  assert.equal(transliterate('ⰰ́ ѣ́'.normalize('NFD')),transliterate('ⰰ́ ѣ́'));
  const block={id:'ocs',type:'paragraph',content:[{text:'Ⱄⰾⱁⰲⱁ ѹ ꙗ'}]};
  const original=structuredClone(block);
  assert.equal(blockTransliteration(block,[]),'Slovo u ya');
  assert.deepEqual(block,original);
});
