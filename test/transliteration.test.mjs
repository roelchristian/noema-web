import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transliterate,blockTransliteration} from '../src/shared/transliteration.ts';

test('Greek includes polytonic vowels, breathings, subscript iota and final sigma',()=>{
  const source='Ἐν ἀρχῇ ἦν ὁ λόγος. αἱ ᾧ ῥυθμός · θεός';
  assert.equal(transliterate(source),'En archē̂i ē̂n ho lógos. hai hō̂i rhuthmós · theós');
  assert.equal(transliterate(source.normalize('NFD')),transliterate(source));
  assert.equal(transliterate('Αἱ Θάλασσαι'),'Hai Thálassai');
});

test('Cyrillic handles Russian, Ukrainian, Serbian and other common letters',()=>{
  assert.equal(transliterate('Привет, мир! Ёж, щука.'),'Privet, mir! Jož, ščuka.');
  assert.equal(transliterate('Українська мова, Љубав, қазақ.'),'Ukrajinsʹka mova, Ljubav, qazaq.');
  assert.equal(transliterate('ж ч ш щ џ ц Ж Ч Ш Щ Џ Ц ЖЧШЩЏЦ'),'ž č š šč dž c Ž Č Š Šč Dž C ŽČŠŠČDŽC');
  assert.equal(transliterate('Жа́р, ча́й, ша́р'.normalize('NFD')),'Žár, čáj, šár');
  assert.equal(transliterate('ҷ ҹ ҽ ҿ ӌ ҵ'),'č č č č č c');
  assert.equal(transliterate('й ё і ї є ґ ў ә ө ү'),'j jo i ji je g ŭ ä ö ü');
  assert.equal(transliterate('й ё'.normalize('NFD')),'j jo');
  assert.equal(transliterate('ЩУКА ΘΕΟΣ ⲐⲈⲞⲤ'),'ŠČUKA THEOS THEOS');
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
  const expected='á à â é è ḗ ḕ ē̂ í ì î ó ò ú ù û ṓ ṑ ō̂ ḯ ǘ ái ài hâi';
  assert.equal(transliterate(source),expected.normalize('NFC'));
  assert.equal(transliterate(source.normalize('NFD')),expected.normalize('NFC'));
});


test('Old Church Slavonic includes historical Cyrillic and Glagolitic without changing the original block',()=>{
  assert.equal(transliterate('Слово ѣ ѧ ѫ ѩ ѭ ѹ ꙋ ꙗ ѿ'),'Slovo ě ę ǫ ję jǫ u u ja ot');
  assert.equal(transliterate('Ⱄⰾⱁⰲⱁ ⱑ ⱔ ⱘ ⱗ ⱙ ⱆ'),'Slovo ě ę ǫ yę yǫ u');
  assert.equal(transliterate('ⰆⰋⰂⰅⰕⰅ'),'ZHIVETE');
  assert.equal(transliterate('ⰰ́ ѣ́'.normalize('NFD')),transliterate('ⰰ́ ѣ́'));
  const block={id:'ocs',type:'paragraph',content:[{text:'Ⱄⰾⱁⰲⱁ ѹ ꙗ'}]};
  const original=structuredClone(block);
  assert.equal(blockTransliteration(block,[]),'Slovo u ja');
  assert.deepEqual(block,original);
});


test('explicit OCS and Bulgarian languages preserve yer case and isolate other Cyrillic conventions',()=>{
  const source='ъ ь Ъ Ь сънъ СЪНЪ СъНь';
  for(const language of ['cu','chu','CU','cu-Cyrl','Old Church Slavonic',' old church slavonic ']) {
    assert.equal(transliterate(source,language),'ŭ ĭ Ŭ Ĭ sŭnŭ SŬNŬ SŭNĭ',language);
  }
  for(const language of ['bg','bul','BG','bg-BG','Bulgarian',' bulgarian ']) {
    assert.equal(transliterate(source,language),'ă ʹ Ă ʹ sănă SĂNĂ SăNʹ',language);
  }
  for(const language of [undefined,null,'','ru','Russian','uk','sr','en','invalid language']) {
    assert.equal(transliterate(source,language),'ʺ ʹ ʺ ʹ sʺnʺ SʺNʺ SʺNʹ',String(language));
    assert.equal(transliterate('ѣъ ꙗь ⱏ ⱐ',language),'ěʺ jaʹ ʺ ʹ','historical letters do not select OCS');
  }
  for(const language of ['cu','bg','ru']) {
    assert.equal(transliterate('θεός ⲁ й ё ї ѣ ꙗ ⱏ ⱐ',language),'theós a j jo ji ě ja ʺ ʹ',language);
  }
});

test('block projection applies the selected language to prose and entity mentions without editing source data',()=>{
  const block={id:'yers',type:'paragraph',content:[{text:'ъЬ '},{entityId:'e'},{text:' '},{entityId:'e',mentionText:'Ьъ'},{text:' ъ',code:true},{text:' ь',math:true}]};
  const entities=[{id:'e',name:'Ъь'}];
  const original=structuredClone({block,entities});
  assert.equal(blockTransliteration(block,entities,'cu'),'ŭĬ Ŭĭ Ĭŭ ъ ь');
  assert.equal(blockTransliteration(block,entities,'bg'),'ăʹ Ăʹ ʹă ъ ь');
  assert.equal(blockTransliteration(block,entities,'ru'),'ʺʹ ʺʹ ʹʺ ъ ь');
  assert.deepEqual({block,entities},original);
});


test('block transliteration omits source and bibliographic references and legacy placeholders',()=>{
  const block={id:'refs',type:'paragraph',content:[
    {text:'Жизнь'},
    {text:' [ref]',sourceReference:{id:'source-ref'}},
    {text:' [ref]',bibliographicReference:{id:'bib-ref'}},
    {text:' прекрасна. [ref]'},
  ]};
  const original=structuredClone(block);
  assert.equal(blockTransliteration(block,[]),'Žiznʹ prekrasna.');
  assert.deepEqual(block,original);
  assert.equal(blockTransliteration({...block,content:[{text:'[ref]',code:true},{text:' мир'}]},[]),'[ref] mir');
  assert.equal(blockTransliteration({...block,content:[{text:'Жизнь',sourceReference:{id:'only-ref'}}]},[]),null);
});


test('Greek upsilon uses u with case, accents, diaeresis and breathing preserved',()=>{
  const source='υ Υ ΥΨΙΛΟΝ ύ ὺ ῦ ϋ ΰ ὑ αὐ εὑ';
  const expected='u U UPSILON ú ù û ü ǘ hu au heu';
  assert.equal(transliterate(source),expected);
  assert.equal(transliterate(source.normalize('NFD')),expected);
});


test('Cyrillic glides use j while y vowels, Latin text and Glagolitic retain y',()=>{
  const source='й ё ю я є ї ѥ ѩ ѭ ꙓ ꙗ ꙝ ҋ ы ꙑ ѵ';
  const expected='j jo ju ja je ji je ję jǫ jě ja ję j y y y';
  assert.equal(transliterate(source),expected);
  assert.equal(transliterate(source.normalize('NFD')),expected);
  assert.equal(transliterate(source.toUpperCase()),'J Jo Ju Ja Je Ji Je Ję Jǫ Jě Ja Ję J Y Y Y');
  assert.equal(transliterate('ЙЁЮЯЄЇ ЫЙ'),'JJOJUJAJEJI YJ');
  assert.equal(transliterate('Яна Юрий май сыр'),'Jana Jurij maj syr');
  assert.equal(transliterate('ya ye yo yu yi ⱓ ⱖ ⱗ ⱙ'),'ya ye yo yu yi yu yo yę yǫ');
});


test('Armenian handles its alphabet, vowel digraphs, ligatures and capitalization',()=>{
 assert.equal(transliterate('Հայաստան Երևան հայերեն ու Ու ՈՒ','hy'),'Hayastan Erevan hayeren u U U');
 assert.equal(transliterate('ԲԱՐԵՎ և ﬓ ﬔ ﬕ ﬖ ﬗ'),'BAREV ev mn me mi vn mkh');
 assert.equal(transliterate('ա բ գ դ ե զ է ը թ ժ ի լ խ ծ կ հ ձ ղ ճ մ յ ն շ ո չ պ ջ ռ ս վ տ ր ց ւ փ ք օ ֆ'),'a b g d e z ē ě tʿ ž i l kh c k h dz gh č m y n š o čʿ p j ṛ s v t r cʿ w pʿ kʿ ō f');
 assert.equal(transliterate('Հայաստան։ «բարև» 123'),'Hayastan։ «barev» 123');
 assert.equal(transliterate('ու́'.normalize('NFD')),'ú');
});

test('Farsi transliterates spelling, explicit vowel marks, hamza and presentation forms',()=>{
 assert.equal(transliterate('سلام فارسی پ چ ژ گ ک ی','fa'),'slām fārsy p č ž g k y');
 assert.equal(transliterate('سَلَام شَدّ آب کِتاب مُدّ دُور شِیر','Farsi'),'salām šadd āb ketāb modd dūr šīr');
 assert.equal(transliterate('می‌روم کتاب‌ها ك ي ﺳﻼﻡ'),'myʹrvm ktābʹhā k y slām');
 assert.equal(transliterate('سـلام ء أ إ ؤ ئ ۀ ع'),'slām ʾ ʾ ʾ ʾ ʾ hʾ ʿ');
 const source='آب کِتاب شَدّ';assert.equal(transliterate(source.normalize('NFD'),'fa-IR'),transliterate(source,'fa'));
 assert.equal(transliterate('سلام، فارسی؟ ۱۲۳'),'slām، fārsy؟ ۱۲۳');
 assert.equal(transliterate('Latin café A‌B 日本語'),'Latin café A‌B 日本語');
});

test('Tajik includes all six additional letters and retains Cyrillic j glides',()=>{
 for(const language of ['tg','tg-Cyrl','tg-TJ','Tajik',' tajik ']){
  assert.equal(transliterate('Тоҷикистон Ҷумҳурӣ ғ ӣ қ ӯ ҳ ҷ',language),'Tojikiston Jumhurī gh ī q ū h j');
  assert.equal(transliterate('Ғ Ӣ Қ Ӯ Ҳ Ҷ ҒӢҚӮҲҶ',language),'Gh Ī Q Ū H J GHĪQŪHJ');
  assert.equal(transliterate('Юсуф Қайроққум Роштқалъа ы',language),'Jusuf Qajroqqum Roštqalʾa y');
  assert.equal(transliterate('ӣ ӯ'.normalize('NFD'),language),'ī ū');
 }
 assert.equal(transliterate('ҷ ъ','ru'),'č ʺ');
});

test('new script projections include entity labels and retain code, maths and source content',()=>{
 for(const [language,text,expected] of [['hy','Հայաստան','Hayastan'],['fa','سلام','slām'],['tg','Тоҷикистон','Tojikiston']]){
  const block={id:'projection',type:'paragraph',content:[{text:text+' '},{entityId:'entity'},{text:' '+text,code:true},{text:' '+text,math:true},{text:' [ref]',sourceReference:{id:'r'}}]};
  const entities=[{id:'entity',name:text}],original=structuredClone({block,entities});
  assert.equal(blockTransliteration(block,entities,language),expected+' '+expected+' '+text+' '+text);
  assert.deepEqual({block,entities},original);
 }
});
