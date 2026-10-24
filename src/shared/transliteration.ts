import {entityMentionName,type Block,type Entity} from './domain.js';

// Script-based Latin transliteration, not pronunciation or translation. Keep these
// explicit mappings stable across locales; no network, model or language detection.
const letters:Record<string,string>={
  α:'a',β:'b',γ:'g',δ:'d',ε:'e',ζ:'z',η:'ē',θ:'th',ι:'i',κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',υ:'y',φ:'ph',χ:'ch',ψ:'ps',ω:'ō',
  ϐ:'b',ϑ:'th',ϕ:'ph',ϖ:'p',ϰ:'k',ϱ:'r',ϲ:'s',ϳ:'j',ϝ:'w',ϛ:'st',ϟ:'q',ϙ:'q',ϡ:'s',
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'ž',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'c',ч:'č',ш:'š',щ:'šč',ъ:'ʺ',ы:'y',ь:'ʹ',э:'e',ю:'yu',я:'ya',
  є:'ye',і:'i',ї:'yi',ґ:'g',ђ:'đ',ѓ:'ǵ',ѕ:'dz',ј:'j',љ:'lj',њ:'nj',ћ:'ć',ќ:'ḱ',ў:'ŭ',џ:'dž',
  ѣ:'ě',ѡ:'ō',ѥ:'ye',ѧ:'ę',ѩ:'yę',ѫ:'ǫ',ѭ:'yǫ',ѯ:'ks',ѱ:'ps',ѳ:'th',ѵ:'y',ѿ:'ot',ꙋ:'u',
  // Historical Cyrillic variants used in Old Church Slavonic.
  ѹ:'u',ѻ:'o',ѽ:'ō',ꙁ:'z',ꙃ:'dz',ꙅ:'dz',ꙇ:'i',ꙉ:'đ',ꙍ:'ō',ꙏ:'ʺ',ꙑ:'y',ꙓ:'yě',ꙗ:'ya',ꙙ:'ę',ꙛ:'ę',ꙝ:'yę',
  // Glagolitic uses its own explicit Latin mappings.
  // Character inventory: https://www.unicode.org/charts/PDF/U2C00.pdf
  ⰰ:'a',ⰱ:'b',ⰲ:'v',ⰳ:'g',ⰴ:'d',ⰵ:'e',ⰶ:'zh',ⰷ:'dz',ⰸ:'z',ⰹ:'i',ⰺ:'i',ⰻ:'i',ⰼ:'đ',ⰽ:'k',ⰾ:'l',ⰿ:'m',ⱀ:'n',ⱁ:'o',ⱂ:'p',ⱃ:'r',ⱄ:'s',ⱅ:'t',ⱆ:'u',ⱇ:'f',ⱈ:'kh',ⱉ:'ō',ⱊ:'p',ⱋ:'shch',ⱌ:'ts',ⱍ:'ch',ⱎ:'sh',ⱏ:'ʺ',ⱐ:'ʹ',ⱑ:'ě',ⱒ:'kh',ⱓ:'yu',ⱔ:'ę',ⱕ:'ę',ⱖ:'yo',ⱗ:'yę',ⱘ:'ǫ',ⱙ:'yǫ',ⱚ:'th',ⱛ:'y',ⱜ:'ʹ',ⱝ:'a',ⱞ:'m',ⱟ:'ch',
  ҕ:'gh',ғ:'gh',ҁ:'q',ҋ:'y',қ:'q',ҝ:'g',ҟ:'q',ҡ:'q',ң:'ng',ҥ:'ng',ҩ:'o',ҫ:'ś',ҭ:'t',ү:'ü',ұ:'ū',ҳ:'h',ҵ:'c',ҷ:'č',ҹ:'č',һ:'h',ҽ:'č',ҿ:'č',ӏ:'l',ӄ:'q',ӈ:'ng',ӌ:'č',ӆ:'l',ӎ:'m',ӊ:'n',ӽ:'kh',ӿ:'kh',ә:'ä',ө:'ö',ӕ:'æ',
  ⲁ:'a',ⲃ:'b',ⲅ:'g',ⲇ:'d',ⲉ:'e',ⲋ:'so',ⲍ:'z',ⲏ:'ē',ⲑ:'th',ⲓ:'i',ⲕ:'k',ⲗ:'l',ⲙ:'m',ⲛ:'n',ⲝ:'x',ⲟ:'o',ⲡ:'p',ⲣ:'r',ⲥ:'s',ⲧ:'t',ⲩ:'u',ⲫ:'ph',ⲭ:'kh',ⲯ:'ps',ⲱ:'ō',
  ϣ:'š',ϥ:'f',ϧ:'kh',ϩ:'h',ϫ:'j',ϭ:'č',ϯ:'ti',ⳉ:'kh',ⳡ:'ng',
};
const supportedScript=/[\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Coptic}\p{Script=Glagolitic}]/u;
const greekScript=/\p{Script=Greek}/u;

// Only explicit language metadata selects yer conventions; shared letters cannot identify a language.
const languageLetters:Record<string,Record<string,string>>={cu:{ъ:'ŭ',ь:'ĭ'},bg:{ъ:'ă'}};
function selectedLetters(language?:string|null):Record<string,string> {
  const name=language?.trim().toLowerCase();
  const tag=name==='old church slavonic'?'cu':name==='bulgarian'?'bg':name;
  if(!tag)return letters;
  try {
    const primary=Intl.getCanonicalLocales(tag)[0]?.split('-')[0]??'';
    return languageLetters[primary]??letters;
  } catch {return letters;}
}

export function transliterate(text:string,language?:string|null):string {
  const overrides=selectedLetters(language);
  return text.normalize('NFC').replace(/[\p{L}\p{M}]+/gu,word=>transliterateWord(word,overrides));
}

function transliterateWord(text:string,overrides:Record<string,string>):string {
  const allCaps=text===text.toUpperCase()&&Array.from(text).filter(letter=>/\p{L}/u.test(letter)).length>1;
  const clusters=text.normalize('NFC').match(/\P{M}\p{M}*|\p{M}+/gu)??[];
  const roughDiphthong=(index:number)=>{
    const previous=clusters[index-1]?.normalize('NFD').toLowerCase()??'';
    const current=clusters[index]?.normalize('NFD').toLowerCase()??'';
    return ['αι','ει','οι','υι','αυ','ευ','ηυ','ου'].includes((previous[0]??'')+(current[0]??''))&&current.includes('\u0314');
  };
  return clusters.map((cluster,index)=>{
    if(!supportedScript.test(cluster))return cluster;
    const original=Array.from(cluster)[0]!;
    let base=original.toLowerCase(),marks=cluster.slice(original.length);
    if(letters[base]===undefined){
      const decomposed=original.normalize('NFD');
      base=Array.from(decomposed)[0]!.toLowerCase();
      marks=decomposed.slice(Array.from(decomposed)[0]!.length)+marks;
    }
    let latin=overrides[base]??letters[base];
    let subscriptIota='';
    if(latin===undefined)return cluster; // Preserve uncommon/unsupported letters.
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
  }).join('');
}

export function blockTransliteration(block:Block,entities:Entity[],language?:string|null):string|null {
  if(!['paragraph','heading1','heading2','quote','bullet','numbered','todo'].includes(block.type)||block.semantic==='ai-explanation')return null;
  let supported=false;
  const text=block.content.map(segment=>{
    const value=segment.entityId?segment.mentionText??entityMentionName(entities.find(entity=>entity.id===segment.entityId))??'':segment.text??'';
    if(segment.math||segment.code)return value;
    supported ||= supportedScript.test(value);
    return transliterate(value,language);
  }).join('');
  return supported?text:null;
}
