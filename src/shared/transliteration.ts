import {entityMentionName,type Block,type Entity,type Segment,type TextStyle} from './domain.js';

// Script-based Latin transliteration, not pronunciation or translation. Keep these
// explicit mappings stable across locales; no network, model or language detection.
const letters:Record<string,string>={
  // Letter-based Armenian mappings, with ու handled as a digraph below.
  // Reference: https://www.loc.gov/catdir/cpso/romanization/armenian.pdf
  ա:'a',բ:'b',գ:'g',դ:'d',ե:'e',զ:'z',է:'ē',ը:'ě',թ:'tʿ',ժ:'ž',ի:'i',լ:'l',խ:'kh',ծ:'c',կ:'k',հ:'h',ձ:'dz',ղ:'gh',ճ:'č',մ:'m',յ:'y',ն:'n',շ:'š',ո:'o',չ:'čʿ',պ:'p',ջ:'j',ռ:'ṛ',ս:'s',վ:'v',տ:'t',ր:'r',ց:'cʿ',ւ:'w',փ:'pʿ',ք:'kʿ',օ:'ō',ֆ:'f',և:'ev',
  // Persian spelling, not inferred pronunciation: unwritten vowels stay unwritten.
  // Reference: https://www.loc.gov/catdir/cpso/romanization/persian.pdf
  ا:'ā',آ:'ā',ب:'b',پ:'p',ت:'t',ث:'s',ج:'j',چ:'č',ح:'ḥ',خ:'kh',د:'d',ذ:'z',ر:'r',ز:'z',ژ:'ž',س:'s',ش:'š',ص:'ṣ',ض:'ẓ',ط:'ṭ',ظ:'ẓ',ع:'ʿ',غ:'gh',ف:'f',ق:'q',ک:'k',ك:'k',گ:'g',ل:'l',م:'m',ن:'n',و:'v',ه:'h',ی:'y',ي:'y',ى:'y',ء:'ʾ',أ:'ʾ',إ:'ʾ',ؤ:'ʾ',ئ:'ʾ',ۀ:'hʾ',ة:'t',
  α:'a',β:'b',γ:'g',δ:'d',ε:'e',ζ:'z',η:'ē',θ:'th',ι:'i',κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',υ:'u',φ:'ph',χ:'ch',ψ:'ps',ω:'ō',
  ϐ:'b',ϑ:'th',ϕ:'ph',ϖ:'p',ϰ:'k',ϱ:'r',ϲ:'s',ϳ:'j',ϝ:'w',ϛ:'st',ϟ:'q',ϙ:'q',ϡ:'s',
  // Cyrillic glides use j; vowel ы (and historical y vowels) retain y.
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'jo',ж:'ž',з:'z',и:'i',й:'j',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'c',ч:'č',ш:'š',щ:'šč',ъ:'ʺ',ы:'y',ь:'ʹ',э:'e',ю:'ju',я:'ja',
  є:'je',і:'i',ї:'ji',ґ:'g',ђ:'đ',ѓ:'ǵ',ѕ:'dz',ј:'j',љ:'lj',њ:'nj',ћ:'ć',ќ:'ḱ',ў:'ŭ',џ:'dž',
  ѣ:'ě',ѡ:'ō',ѥ:'je',ѧ:'ę',ѩ:'ję',ѫ:'ǫ',ѭ:'jǫ',ѯ:'ks',ѱ:'ps',ѳ:'th',ѵ:'y',ѿ:'ot',ꙋ:'u',
  // Historical Cyrillic variants used in Old Church Slavonic.
  ѹ:'u',ѻ:'o',ѽ:'ō',ꙁ:'z',ꙃ:'dz',ꙅ:'dz',ꙇ:'i',ꙉ:'đ',ꙍ:'ō',ꙏ:'ʺ',ꙑ:'y',ꙓ:'jě',ꙗ:'ja',ꙙ:'ę',ꙛ:'ę',ꙝ:'ję',
  // Glagolitic uses its own explicit Latin mappings.
  // Character inventory: https://www.unicode.org/charts/PDF/U2C00.pdf
  ⰰ:'a',ⰱ:'b',ⰲ:'v',ⰳ:'g',ⰴ:'d',ⰵ:'e',ⰶ:'zh',ⰷ:'dz',ⰸ:'z',ⰹ:'i',ⰺ:'i',ⰻ:'i',ⰼ:'đ',ⰽ:'k',ⰾ:'l',ⰿ:'m',ⱀ:'n',ⱁ:'o',ⱂ:'p',ⱃ:'r',ⱄ:'s',ⱅ:'t',ⱆ:'u',ⱇ:'f',ⱈ:'kh',ⱉ:'ō',ⱊ:'p',ⱋ:'shch',ⱌ:'ts',ⱍ:'ch',ⱎ:'sh',ⱏ:'ʺ',ⱐ:'ʹ',ⱑ:'ě',ⱒ:'kh',ⱓ:'yu',ⱔ:'ę',ⱕ:'ę',ⱖ:'yo',ⱗ:'yę',ⱘ:'ǫ',ⱙ:'yǫ',ⱚ:'th',ⱛ:'y',ⱜ:'ʹ',ⱝ:'a',ⱞ:'m',ⱟ:'ch',
  ҕ:'gh',ғ:'gh',ҁ:'q',ҋ:'j',қ:'q',ҝ:'g',ҟ:'q',ҡ:'q',ң:'ng',ҥ:'ng',ҩ:'o',ҫ:'ś',ҭ:'t',ү:'ü',ұ:'ū',ҳ:'h',ҵ:'c',ҷ:'č',ҹ:'č',һ:'h',ҽ:'č',ҿ:'č',ӏ:'l',ӄ:'q',ӈ:'ng',ӌ:'č',ӆ:'l',ӎ:'m',ӊ:'n',ӽ:'kh',ӿ:'kh',ә:'ä',ө:'ö',ӕ:'æ',
  ⲁ:'a',ⲃ:'b',ⲅ:'g',ⲇ:'d',ⲉ:'e',ⲋ:'so',ⲍ:'z',ⲏ:'ē',ⲑ:'th',ⲓ:'i',ⲕ:'k',ⲗ:'l',ⲙ:'m',ⲛ:'n',ⲝ:'x',ⲟ:'o',ⲡ:'p',ⲣ:'r',ⲥ:'s',ⲧ:'t',ⲩ:'u',ⲫ:'ph',ⲭ:'kh',ⲯ:'ps',ⲱ:'ō',
  ϣ:'š',ϥ:'f',ϧ:'kh',ϩ:'h',ϫ:'j',ϭ:'č',ϯ:'ti',ⳉ:'kh',ⳡ:'ng',
};
const persianScript=/\p{Script=Arabic}/u;
const persianMarks:Record<string,string>={'\u064b':'an','\u064c':'on','\u064d':'en','\u064e':'a','\u064f':'o','\u0650':'e','\u0652':'','\u0654':'ʾ','\u0655':'ʾ','\u0670':'ā'};
const supportedScript=/[\p{Script=Armenian}\p{Script=Arabic}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Coptic}\p{Script=Glagolitic}]/u;
const greekScript=/\p{Script=Greek}/u;

// Only explicit language metadata selects language-specific conventions. Tajik
// retains the shared Cyrillic j glides, with ī/ū for its marked vowels.
// Alphabet reference: https://www.gov.uk/government/publications/romanization-systems
const languageLetters:Record<string,Record<string,string>>={cu:{ъ:'ŭ',ь:'ĭ'},bg:{ъ:'ă'},tg:{ҷ:'j',ӣ:'ī',ӯ:'ū',ъ:'ʾ'}};
function selectedLetters(language?:string|null):Record<string,string> {
  const name=language?.trim().toLowerCase();
  const aliases:Record<string,string>={'old church slavonic':'cu',bulgarian:'bg',tajik:'tg'};
  const tag=name?aliases[name]??name:undefined;
  if(!tag)return letters;
  try {
    const primary=Intl.getCanonicalLocales(tag)[0]?.split('-')[0]??'';
    return languageLetters[primary]??letters;
  } catch {return letters;}
}

export function transliterate(text:string,language?:string|null):string {
  const overrides=selectedLetters(language);
  // Expand only encoded Armenian ligatures and Arabic presentation forms. Other
  // scripts and Latin compatibility characters retain their original spelling.
  const normalized=text.replace(/[\uFB13-\uFB17\uFB50-\uFDFF\uFE70-\uFEFC]/gu,letter=>letter.normalize('NFKC')).normalize('NFC');
  return normalized.replace(/[\p{L}\p{M}\u200c\u200d]+/gu,word=>transliterateWord(word,overrides));
}

function transliterateWord(text:string,overrides:Record<string,string>):string {
  const persianWord=persianScript.test(text);
  const allCaps=text!==text.toLowerCase()&&text===text.toUpperCase()&&Array.from(text).filter(letter=>/\p{L}/u.test(letter)).length>1;
  const clusters=text.normalize('NFC').match(/\P{M}\p{M}*|\p{M}+/gu)??[];
  const roughDiphthong=(index:number)=>{
    const previous=clusters[index-1]?.normalize('NFD').toLowerCase()??'';
    const current=clusters[index]?.normalize('NFD').toLowerCase()??'';
    return ['αι','ει','οι','υι','αυ','ευ','ηυ','ου'].includes((previous[0]??'')+(current[0]??''))&&current.includes('\u0314');
  };
  return clusters.map((cluster,index)=>{
    if(cluster==='\u200c')return persianWord?'ʹ':cluster;
    if(cluster==='\u200d')return persianWord?'':cluster;
    if(cluster==='ـ')return '';
    if(!supportedScript.test(cluster))return cluster;
    const original=Array.from(cluster)[0]!;
    let base=original.toLowerCase(),marks=cluster.slice(original.length);
    if(letters[base]===undefined&&overrides[base]===undefined){
      const decomposed=original.normalize('NFD');
      base=Array.from(decomposed)[0]!.toLowerCase();
      marks=decomposed.slice(Array.from(decomposed)[0]!.length)+marks;
    }
    let latin=overrides[base]??letters[base];
    let subscriptIota='';
    if(latin===undefined)return cluster; // Preserve uncommon/unsupported letters.
    // Armenian ու is one vowel, in lowercase, title case and all capitals.
    if(base==='ո'&&!marks&&clusters[index+1]?.toLowerCase().startsWith('ւ'))latin='u';
    if(base==='ւ'&&clusters[index-1]?.toLowerCase()==='ո')return marks;
    if(persianScript.test(original)){
      const previous=clusters[index-1]??'',next=clusters[index+1]??'';
      // Explicit short-vowel marks disambiguate written long vowels. Never
      // infer these readings from unvocalized spelling or fill missing vowels.
      if(base==='ا'&&/[\u064e\u064f\u0650]/u.test(marks))latin='';
      if((base==='ی'||base==='ي'||base==='ى')&&previous.includes('\u0650'))latin='ī';
      if(base==='و'&&previous.includes('\u064f'))latin='ū';
      if(marks.includes('\u0651'))latin+=latin;
      if(next.startsWith('ا'))marks=marks.replace(/\u064e/g,'');
      if(/^[یيى]/u.test(next))marks=marks.replace(/\u0650/g,'');
      if(next.startsWith('و'))marks=marks.replace(/\u064f/g,'');
      marks=Array.from(marks.replace(/\u0651/g,'')).map(mark=>persianMarks[mark]??mark).join('');
    }
    if(greekScript.test(original)){
      if(marks.includes('\u0314')&&!roughDiphthong(index))latin=base==='ρ'?latin+'h':'h'+latin;
      if(roughDiphthong(index+1))latin='h'+latin;
      if(marks.includes('\u0345'))subscriptIota=allCaps?'I':'i';
      // Keep acute, grave and diaeresis on the vowel. Represent the Greek
      // perispomeni with a Latin circumflex; breathing is handled above.
      marks=marks.replace(/\u0342/g,'\u0302').replace(/[\u0313\u0314\u0345]/g,'');
    }
    if(original!==original.toLowerCase())latin=allCaps?latin.toUpperCase():latin[0]!.toUpperCase()+latin.slice(1);
    return (latin+marks+subscriptIota).normalize('NFC');
  }).join('').normalize('NFC');
}

/** Project display text and marks without changing the authored block or citation data. */
export function blockTransliterationSegments(block:Block,entities:Entity[],language?:string|null):Segment[]|null {
  if(!['paragraph','heading1','heading2','quote','bullet','numbered','todo'].includes(block.type)||block.semantic==='ai-explanation')return null;
  let supported=false;
  const content:(TextStyle&{text:string})[]=block.content.filter(segment=>!segment.sourceReference&&!segment.bibliographicReference).map(segment=>{
    const value=segment.entityId?segment.mentionText??entityMentionName(entities.find(entity=>entity.id===segment.entityId))??'':segment.text??'';
    const {entityId,mentionText,...style}=segment;
    if(segment.math||segment.code)return {...style,text:value};
    const prose=value.replace(/[ \t]*\[ref\]/gi,'');
    supported ||= supportedScript.test(prose);
    return {...style,text:transliterate(prose,language)};
  });
  // Reference atoms often leave a trailing spacer; keep it out of the display.
  for(let index=content.length-1;index>=0;index--){
    content[index]={...content[index],text:(content[index]!.text??'').trimEnd()};
    if(content[index]!.text)break;
  }
  return supported?content:null;
}

export function blockTransliteration(block:Block,entities:Entity[],language?:string|null):string|null {
  return blockTransliterationSegments(block,entities,language)?.map(segment=>segment.text??'').join('')??null;
}
